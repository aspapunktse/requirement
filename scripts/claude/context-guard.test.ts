// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Runs the context-guard hook as Claude Code does: JSON on stdin, JSON on stdout.
const SCRIPT = path.resolve(__dirname, "context-guard.mjs");
const LIMIT = 250_000; // notice at 150k, checkpoint at 180k, repeat every 15k

// Each test starts Node several times (about 0.6 s each on Windows), and the
// snapshot also runs git and gh.
vi.setConfig({ testTimeout: 60_000 });

let projectDir: string;
let transcript: string;

function runHook(mode: string, input: unknown): string {
  return execFileSync("node", [SCRIPT, mode], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CONTEXT_GUARD_LIMIT: String(LIMIT) },
    timeout: 30_000,
  });
}

function assistantLine(tokens: number, isSidechain = false) {
  return JSON.stringify({
    type: "assistant",
    isSidechain,
    message: { usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: tokens - 10, output_tokens: 5 } },
  });
}

function compactLine(postTokens: number) {
  return JSON.stringify({ type: "system", subtype: "compact_boundary", compactMetadata: { postTokens } });
}

function append(...lines: string[]) {
  fs.appendFileSync(transcript, lines.join("\n") + "\n");
}

function nudge(extra: Record<string, unknown> = {}) {
  const out = runHook("nudge", {
    session_id: "test",
    transcript_path: transcript,
    hook_event_name: "PostToolUse",
    ...extra,
  });
  return out ? (JSON.parse(out).hookSpecificOutput.additionalContext as string) : "";
}

const carryOver = () => path.join(projectDir, ".claude", "supervisor-carry-over.md");

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "context-guard-"));
  transcript = path.join(projectDir, "transcript.jsonl");
  fs.writeFileSync(transcript, "");
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("nudge", () => {
  it("stays silent below the notice level", () => {
    append(assistantLine(100_000));
    expect(nudge()).toBe("");
  });

  it("gives the notice once, then the checkpoint, repeating only every 15k", () => {
    append(assistantLine(160_000));
    expect(nudge()).toContain("next stage boundary");
    append(assistantLine(165_000));
    expect(nudge()).toBe("");

    append(assistantLine(190_000));
    expect(nudge()).toContain("Before your next step");
    append(assistantLine(200_000));
    expect(nudge()).toBe("");
    append(assistantLine(206_000));
    expect(nudge()).toContain("206k of the 250k budget");
  });

  it("starts over after a compaction", () => {
    append(assistantLine(190_000));
    expect(nudge()).toContain("Before your next step");
    append(compactLine(20_000));
    expect(nudge()).toBe("");
    append(assistantLine(160_000));
    expect(nudge()).toContain("next stage boundary");
  });

  it("ignores sub-agent turns and sub-agent tool calls", () => {
    append(assistantLine(100_000), assistantLine(300_000, true));
    expect(nudge()).toBe("");
    append(assistantLine(300_000));
    expect(nudge({ agent_id: "implementer" })).toBe("");
  });

  it("uses the event name it was called for", () => {
    append(assistantLine(190_000));
    const out = runHook("nudge", { session_id: "test", transcript_path: transcript, hook_event_name: "UserPromptSubmit" });
    expect(JSON.parse(out).hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
  });

  it("exits cleanly on malformed input or a missing transcript", () => {
    expect(runHook("nudge", "not json")).toBe("");
    expect(nudge({ transcript_path: path.join(projectDir, "missing.jsonl") })).toBe("");
    fs.writeFileSync(transcript, "{broken\n");
    expect(nudge()).toBe("");
  });
});

describe("pre-compact", () => {
  it("appends one auto snapshot and keeps the supervisor's notes", () => {
    fs.mkdirSync(path.dirname(carryOver()));
    fs.writeFileSync(carryOver(), "# Supervisor carry-over\n\n## Next action\n\nReview #999.\n");
    runHook("pre-compact", { trigger: "auto" });
    runHook("pre-compact", { trigger: "manual" });
    const body = fs.readFileSync(carryOver(), "utf8");
    expect(body).toContain("Review #999.");
    expect(body.match(/## Auto snapshot/g)).toHaveLength(1);
    expect(body).toContain("trigger: manual");
  });

  it("creates the file when there is none", () => {
    runHook("pre-compact", { trigger: "auto" });
    expect(fs.readFileSync(carryOver(), "utf8")).toMatch(/^# Supervisor carry-over[\s\S]*## Auto snapshot/);
  });
});

describe("restore", () => {
  const restore = (source: string) => {
    const out = runHook("restore", { source });
    return out ? (JSON.parse(out).hookSpecificOutput.additionalContext as string) : "";
  };

  it("puts the carry-over file back after a compaction", () => {
    fs.mkdirSync(path.dirname(carryOver()));
    fs.writeFileSync(carryOver(), "## Next action\n\nMerge PR #998.\n");
    const text = restore("compact");
    expect(text).toContain("just compacted");
    expect(text).toContain("Merge PR #998.");
    expect(text).toContain("keep running across compaction");
  });

  it("warns that a new session can't reach the earlier implementers", () => {
    fs.mkdirSync(path.dirname(carryOver()));
    fs.writeFileSync(carryOver(), "## Next action\n\nMerge PR #998.\n");
    expect(restore("startup")).toContain("can't be messaged from here");
  });

  it("without a file: silent on startup, a pointer to the docs after a compaction", () => {
    expect(restore("startup")).toBe("");
    expect(restore("compact")).toContain("re-read HANDOFF.md");
  });
});
