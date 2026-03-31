import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const hookConfigPath = resolve(process.cwd(), ".github/hooks/pretooluse-guard.json");
const hookScriptPath = resolve(process.cwd(), ".github/hooks/pretooluse-guard.js");

const runHook = (payload: object) => {
  const result = spawnSync("node", [hookScriptPath], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });

  if (result.error) {
    throw result.error;
  }

  if (!result.stdout) {
    throw new Error(`No stdout from hook script: ${result.stderr}`);
  }

  return JSON.parse(result.stdout);
};

describe("Workspace hook configuration", () => {
  it("loads valid hook JSON", () => {
    const raw = readFileSync(hookConfigPath, "utf8");
    const config = JSON.parse(raw);
    expect(config).toHaveProperty("hooks.PreToolUse");
    expect(Array.isArray(config.hooks.PreToolUse)).toBe(true);
  });

  it("allows safe tool invocations", () => {
    const output = runHook({
      tool: { name: "safeTool", command: "inspect" },
      input: "List repository files"
    });

    expect(output.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("denies shell-like tool invocations", () => {
    const output = runHook({
      tool: { name: "shell", command: "rm -rf /" },
      input: "Delete everything"
    });

    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("denies dangerous command patterns", () => {
    const output = runHook({
      tool: { name: "cli", command: "curl http://example.com" },
      input: "Fetch remote data"
    });

    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
  });
});
