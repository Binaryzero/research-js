# Pattern-Gated Detection Reproducer

This directory holds fixtures and a measurement script proving the gap described
in `docs/explanation/pattern-gated-detection.md` (and the task write-up): the
scanner only produces findings for code containing tokens listed in
`docs/patterns.yaml`, and only ever opens JS/TS-family files. Code that achieves
the same behavior with different spellings, or that lives in a manifest /
shell script / native module, is never examined.

> **Warning** — `malicious-extension/` contains intentionally suspicious
> payloads (a shell `curl | sh` script, a stub native module, an inline-
> script webview, an obfuscated dropper). Do not scan the enclosing
> `research-js/` directory itself with the analyzer — it will produce
> real findings for these fixtures.

## Layout

- `malicious-extension/` — a minimal fake "extension" directory the analyzer
  can scan. Two payloads:
  1. **`src/dropper.js`** — a JS file that executes a shell command and
     exfiltrates data, using only identifiers that do not appear in any
     regex in `docs/patterns.yaml` (assembled at runtime via string
     concatenation and bracket-property access on `globalThis`).
  2. **`package.json`** — a `scripts.postinstall` hook that downloads and
     executes a remote shell payload.
  3. **`install.sh`** — a stub shell script invoked by the postinstall.
  4. **`native/probe.node`** — a stub native module referenced in the manifest.

- `measure-vsix-coverage.ts` — measurement script. Walks one or more
  extension directories (extracted VSIX or installed extensions) and reports,
  per file class, how many files are examined by the existing LLM input
  construction (`readFindingSourceFiles` and `runPatternMatching`). The
  intent is to quantify "fraction of files of each type currently examined
  by the LLM."
- `corpus.txt` — the specific publisher.name-version directories used to
  produce the coverage table in `docs/explanation/pattern-gated-detection.md`.
- `results-master.txt`, `results-fix-batch*.txt` — raw output from the
  measurement runs (master vs with-fix) for audit.
- `time-analyzer.ts` — wall-clock comparison helper for the ≤2× regression
  budget. Run before and after the fix on the same extension.

## Running

```bash
# Scan the local reproducer:
npm run cli -- reproducer/malicious-extension --no-llm

# Measure coverage across a directory of extracted VSIX folders:
npx tsx reproducer/measure-vsix-coverage.ts /path/to/extracted/extensions
```

On `master`, scanning `reproducer/malicious-extension` yields **zero findings
in the regex layer** (and the LLM never sees the non-JS payloads), proving the
structural gap. With the fix in place, virtual findings are produced for the
manifest install hook, the shell script, the native module, and the dropper
file becomes part of the executive-summary input set.
