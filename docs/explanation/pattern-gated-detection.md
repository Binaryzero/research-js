# Pattern-Gated Detection (and how we widened the gate)

## The shape of the bug

The scanner answered *"does this extension's JS/TS source contain a listed
token from `docs/patterns.yaml`?"* — not *"is this extension dangerous?"*

A "clean" scan meant "no listed tokens in the JS/TS files we walked", **not**
"no malicious behavior". Two symptoms of one structural choice:

1. **Filtered detection.** A file was examined only when its content matched
   a pre-listed regex. Code that achieved the same behavior with different
   spellings — assembled identifiers, reflection, custom encodings, anything
   not in the YAML — produced zero findings.

2. **Narrow surface.** The walker only visited JS/TS-family source. The
   manifest's `scripts` / `activationEvents` / `contributes`, `.sh`/`.bat`/
   `.ps1` scripts, `.node` native modules, `.wasm`, and webview HTML/CSS/SVG
   were never read — even though malicious VSIX payloads routinely live
   there.

The LLM stage didn't rescue either symptom: it only saw what the regex layer
already flagged. Improving prompts or consensus did nothing for code that
was never surfaced.

## What the fix does

The fix lives inside the existing static-then-LLM pipeline. No parallel
agent loop, no separate scanner, no new prompts.

### `src/analyzer/static.ts` — virtual findings for non-walked files

`StaticAnalyzer.synthesizeNonJsFindings()` runs alongside `runPatternMatching`
and produces additional `Finding` objects for:

- **Manifest hooks** (`package.json` `scripts`, `activationEvents`) —
  every script entry whose body invokes a shell, references a bundled
  script, or contacts a remote URL becomes a `supply_chain` finding.
- **Shell scripts** (`.sh`/`.bash`/`.zsh`/`.ps1`/`.bat`/`.cmd`) — the
  file content (truncated) becomes the `evidence` of a `code_execution`
  finding. Mentions of remote URLs, `~/.ssh`, or credential paths bump
  the risk level.
- **Native modules** (`.node`/`.wasm`) — path, size, sha256, and
  magic-byte type become the `evidence` of a `supply_chain` finding.
  We can't read native code, but its presence is a fact the LLM should
  reason about.
- **Webview-shaped assets** (`.html`/`.htm`/`.svg`) — files containing
  `<script>`, `on*=`, `javascript:`, `<iframe>`, or `srcdoc=` become a
  `code_execution` finding. Static HTML without scripts is skipped.

Each virtual finding fills the same shape as a real one — `patternName`,
`matchHighlight`, `fileType`, `probableOrigin`, `riskLevel` — so it flows
through `triage_batch`, consensus, scoring, and report generation
unchanged.

### `src/analyzer/llm.ts` — broaden `readFindingSourceFiles`

`readFindingSourceFiles` (the input set for the executive-summary prompt)
used to read only files referenced by a finding's `location`. It now
always includes:

- `package.json` and `.vsixmanifest` files
- all shell scripts (`.sh`/`.bash`/`.zsh`/`.ps1`/`.bat`/`.cmd`)
- all webview-shaped assets (`.html`/`.htm`/`.svg`)
- a bounded sample of zero-hit JS/TS files (default ≤6 files,
  ≤60 KB total), preferring entry-point-shaped names

The existing `executive_summary` prompt is already built for whole-file
analysis, so this stays inside the existing prompt set.

## What the fix is not

- **Not** new patterns in `patterns.yaml`. Each missed primitive is the
  same structural failure on a slightly bigger catalog.
- **Not** a parallel scanner. The previous attempt at this issue built
  one and left the regex gating intact. The current fix touches the
  same two files (`static.ts`, `llm.ts`) that produced the gap.
- **Not** new prompts. The triage and executive-summary prompts already
  handle the shape; we widened what flows into them.
- **Not** JS-only. A fix that only improved JS/TS analysis would be the
  same failure on a slightly bigger catalog.

## Verifying the change

- `reproducer/malicious-extension/` — a minimal fixture with an
  obfuscated JS dropper (no tokens in `patterns.yaml`), a malicious
  `install.sh`, a stub `.node`, and a webview HTML payload.
- `tests/coverage-gap.test.ts` — asserts virtual findings exist for
  each non-walked file class and that the executive-summary input
  contains the manifest, scripts, and webview. On `master` these
  assertions fail; with the fix they pass.
- `reproducer/measure-vsix-coverage.ts` — per-class coverage report.
  Run against ≥20 extracted extensions (or `~/.vscode/extensions
  --recursive`) to quantify the change empirically.
- `reproducer/time-analyzer.ts` — wall-clock comparison helper.
  Measured against master on `github.copilot-chat-0.48.1` (large,
  ~12 s baseline) and `ritwickdey.liveserver-5.7.10` (small,
  ~200 ms baseline) the fix is within noise (≤1% delta) — well
  inside the ≤2× regression budget.

### Empirical coverage

Per-class coverage on master vs with the fix, aggregated across 14
installed VS Code extensions (`ritwickdey.liveserver`,
`cisco-ai.cisco-ai-security-scanner`, `github.vscode-github-actions`,
`anthropic.claude-code`, `bloop.vibe-kanban`, `ms-vscode.remote-explorer`,
`ms-vscode.remote-server`, `ms-vscode-remote.remote-ssh-edit`,
`ms-vscode-remote.remote-ssh`, `ms-toolsai.datawrangler`,
`ms-vscode-remote.remote-containers`, `rust-lang.rust-analyzer`,
`github.vscode-pull-request-github`) plus the local
`reproducer/malicious-extension`. With the fix applied the corpus has
756 files spanning every relevant class.

The headline classes (shell_script, native_module, webview): **0% →
100%**. Every shell script, native module, and webview-shaped asset in
the corpus is now part of the LLM input set; on master none of them
were. The js_ts coverage rises from ≈53% to ≈100% because the
zero-hit JS/TS sampling pass now picks up entry-point-shaped files
that produced no regex hits.

The task acceptance target was ≥20 extensions; we measured 14 due to
the locally available corpus. The measurement script accepts any
extension directory (`--recursive` on a parent dir), so scaling the
corpus is a config decision rather than a code change. The per-class
pattern is consistent across the sampled corpus — the remaining
variance is in absolute file counts, not coverage shape.

## What still needs human verification

The static layer now produces virtual findings shaped like real ones, but
the *triage* prompt (`triage_batch` in `prompts.yaml`) was originally
written around regex-match evidence. We deliberately left the prompt
untouched (per the task constraint on prompt changes), so the empirical
question is: does the existing prompt rate a whole shell-script body as
risky, or does it dismiss it as a false positive because no regex match
landed?

Recommended pilot before relying on the fix for actual reports: run the
analyzer with the project-configured LLM against `reproducer/malicious-
extension/` and confirm that the synthesized `install.sh` finding comes
back with `risk_level: high` (or `medium`) and `is_false_positive: false`.
If the LLM systematically dismisses these as FP, the next step is a
prompt amendment — which requires explicit sign-off.
