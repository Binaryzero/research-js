#!/usr/bin/env node
import process from "node:process";

const blockedToolNames = [
  "shell",
  "bash",
  "sh",
  "zsh",
  "pwsh",
  "cmd",
  "powershell",
  "terminal",
  "command"
];

const blockedPatterns = [
  /\brm\b/,
  /\bdel\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\bmv\b/,
  /\bcp\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bkillall\b/,
  /\bkill\b/,
  /\bshutdown\b/,
  /\bcurl\b/,
  /\bwget\b/,
  /\bftp\b/,
  /\bscp\b/,
  /\bssh\b/,
  /\bnetcat\b/,
  /\bnc\b/,
  /\bdocker\b/,
  /\bkubectl\b/,
  /\bhelm\b/,
  /\bterraform\b/,
  /\bansible\b/
];

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks).toString("utf8") : "";
};

const normalizeText = (value) => {
  if (typeof value === "string") {
    return value.toLowerCase();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeText).join(" ");
  }
  if (value && typeof value === "object") {
    return Object.values(value).map(normalizeText).join(" ");
  }
  return "";
};

const buildDecision = (decision, reason) => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: decision,
    permissionDecisionReason: reason
  }
});

const main = async () => {
  const raw = await readStdin();
  if (!raw) {
    console.log(JSON.stringify(buildDecision("deny", "No PreToolUse payload received.")));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    console.log(JSON.stringify(buildDecision("deny", "Unable to parse PreToolUse payload; denying for security.")));
    return;
  }

  const tool = payload.tool || payload.toolInfo || {};
  const candidates = [
    tool.name,
    tool.command,
    tool.input,
    tool.args,
    payload.toolName,
    payload.input,
    payload.command,
    payload.arguments,
    payload.tool?.description
  ];

  const normalized = normalizeText(candidates);

  const hasBlockedToolName = blockedToolNames.some((name) => new RegExp("\\\\b" + name + "\\\\b").test(normalized));
  const hasBlockedPattern = blockedPatterns.some((pattern) => pattern.test(normalized));

  if (hasBlockedToolName || hasBlockedPattern) {
    console.log(JSON.stringify(buildDecision("deny", "This tool invocation matches a blocked shell or destructive command pattern.")));
    return;
  }

  console.log(JSON.stringify(buildDecision("allow", "PreToolUse validation passed.")));
};

main();
