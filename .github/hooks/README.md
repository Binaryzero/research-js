# Workspace Hooks

This workspace defines a deterministic `PreToolUse` hook in `.github/hooks/pretooluse-guard.json`.

## Purpose

The hook validates tool invocations before they are executed by the agent. It applies a workspace-level policy that denies shell-like tools and destructive command patterns such as `rm`, `chmod`, `curl`, `ssh`, and related runtime operations.

## Files

- `.github/hooks/pretooluse-guard.json` — workspace hook configuration
- `.github/hooks/pretooluse-guard.js` — validation script used by the hook

## Testing

Run the repository test suite with:

```bash
npm test
```

The hook validation script is also directly runnable with sample JSON on stdin.
