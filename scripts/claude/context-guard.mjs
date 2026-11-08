#!/usr/bin/env node
// Claude Code hook: keeps the supervisor's memory across compaction.
//
// The 250k ceiling itself is enforced by Claude Code's `autoCompactWindow`
// setting (see docs/agents/supervised-workflow.md, "Context budget"). This
// hook makes sure nothing is lost when that compaction happens:
//
//   node scripts/claude/context-guard.mjs nudge        (PostToolUse, UserPromptSubmit)
//     Reads the context size from the transcript. Past the notice and
//     checkpoint levels it tells the supervisor to update the carry-over file.
//   node scripts/claude/context-guard.mjs pre-compact  (PreCompact)
//     Appends a mechanical snapshot (worktrees, open PRs) to the carry-over file.
//   node scripts/claude/context-guard.mjs restore      (SessionStart)
//     Puts the carry-over file back into context after compaction, resume or
//     a fresh start.
//
// The carry-over file is .claude/supervisor-carry-over.md: local, untracked.
// Settings: CONTEXT_GUARD_LIMIT (tokens, default 250000).
// Hooks must never break the session, so every failure exits 0 silently.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const LIMIT = Number(process.env.CONTEXT_GUARD_LIMIT) || 250_000;
const NOTICE = Math.round(LIMIT * 0.6); // 150k: refresh carry-over at the next stage boundary
const CHECKPOINT = Math.round(LIMIT * 0.72); // 180k: refresh it now
const REPEAT = Math.round(LIMIT * 0.06); // then again every 15k

const mode = process.argv[2];

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

const input = readStdin();
const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const claudeDir = path.join(projectDir, ".claude");
const carryOverPath = path.join(claudeDir, "supervisor-carry-over.md");
const carryOverRel = ".claude/supervisor-carry-over.md";

function emit(eventName, text) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } }),
  );
}

// Context size = input + cache tokens of the last main-chain assistant turn.
// A compact boundary after that turn means the context is now its postTokens.
function contextTokens(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  const size = fs.statSync(transcriptPath).size;
  const chunk = Math.min(size, 4 * 1024 * 1024);
  const fd = fs.openSync(transcriptPath, "r");
  const buf = Buffer.alloc(chunk);
  fs.readSync(fd, buf, 0, chunk, size - chunk);
  fs.closeSync(fd);
  const lines = buf.toString("utf8").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"usage"') && !line.includes("compact_boundary")) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // first line of the chunk may be cut off
    }
    if (entry.subtype === "compact_boundary") return entry.compactMetadata?.postTokens ?? 0;
    const usage = entry.message?.usage;
    if (entry.type !== "assistant" || entry.isSidechain || !usage) continue;
    return (
      (usage.input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0) +
      (usage.cache_read_input_tokens || 0)
    );
  }
  return null;
}

function statePath(sessionId) {
  return path.join(claudeDir, "state", `context-guard-${sessionId || "unknown"}.json`);
}

function readState(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(statePath(sessionId), "utf8"));
  } catch {
    return { noticed: false, lastCheckpoint: 0 };
  }
}

function writeState(sessionId, state) {
  fs.mkdirSync(path.dirname(statePath(sessionId)), { recursive: true });
  fs.writeFileSync(statePath(sessionId), JSON.stringify(state));
}

const k = (n) => `${Math.round(n / 1000)}k`;

function nudge() {
  if (input.agent_id) return; // a sub-agent's tool call, not the supervisor's
  const tokens = contextTokens(input.transcript_path);
  if (tokens == null) return;
  const state = readState(input.session_id);
  const eventName = input.hook_event_name || "PostToolUse";

  // Compaction happened: start the bands over.
  if (tokens < NOTICE) {
    if (state.noticed || state.lastCheckpoint) writeState(input.session_id, { noticed: false, lastCheckpoint: 0 });
    return;
  }

  if (tokens >= CHECKPOINT && tokens - state.lastCheckpoint >= REPEAT) {
    writeState(input.session_id, { noticed: true, lastCheckpoint: tokens });
    emit(
      eventName,
      `Context guard: context is ${k(tokens)} of the ${k(LIMIT)} budget; auto-compaction is close. ` +
        `Before your next step, update ${carryOverRel} (the template is in docs/agents/supervised-workflow.md, ` +
        `"Context budget"): every in-flight issue with its stage, worktree, database and implementer agent id; ` +
        `PRs waiting on CI or CD; open product-owner questions and the defaults you briefed; decisions not yet ` +
        `recorded on an issue; the exact next action. Then carry on; compaction will not lose that file.`,
    );
    return;
  }

  if (!state.noticed) {
    writeState(input.session_id, { ...state, noticed: true });
    emit(
      eventName,
      `Context guard: context is ${k(tokens)} of the ${k(LIMIT)} budget. At the next stage boundary ` +
        `(a hand-back reviewed, a PR opened, a merge watched, before briefing the next issue) bring ` +
        `${carryOverRel} up to date so compaction loses nothing.`,
    );
  }
}

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      cwd: projectDir,
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "(unavailable)";
  }
}

function preCompact() {
  fs.mkdirSync(claudeDir, { recursive: true });
  const marker = "## Auto snapshot";
  let body = fs.existsSync(carryOverPath) ? fs.readFileSync(carryOverPath, "utf8") : "# Supervisor carry-over\n";
  const cut = body.indexOf(marker);
  if (cut !== -1) body = body.slice(0, cut).trimEnd() + "\n";
  const snapshot = [
    "",
    `${marker} (written by the PreCompact hook, ${new Date().toISOString()}, trigger: ${input.trigger || "unknown"})`,
    "",
    "Mechanical state only; the sections above are the supervisor's own notes.",
    "",
    "Worktrees:",
    "```",
    run("git", ["worktree", "list"]),
    "```",
    "",
    "Open PRs:",
    "```",
    run("gh", ["pr", "list", "--state", "open", "--json", "number,title,headRefName", "--template",
      '{{range .}}#{{.number}} {{.headRefName}}: {{.title}}{{"\\n"}}{{end}}']),
    "```",
    "",
  ].join("\n");
  fs.writeFileSync(carryOverPath, body + snapshot, "utf8");
}

function restore() {
  const source = input.source || "startup";
  const head =
    source === "compact"
      ? "The conversation was just compacted to stay under the context budget."
      : source === "resume"
        ? "This session was resumed."
        : "A new session started.";
  if (!fs.existsSync(carryOverPath)) {
    if (source === "compact") {
      emit(
        "SessionStart",
        `${head} No ${carryOverRel} exists, so re-read HANDOFF.md and docs/agents/supervised-workflow.md ` +
          `before continuing, and create the carry-over file from the template there.`,
      );
    }
    return;
  }
  const notes = fs.readFileSync(carryOverPath, "utf8");
  const agentNote =
    source === "compact"
      ? "Background implementers keep running across compaction; reach them with SendMessage and the agent ids below."
      : "Agent ids below belong to the earlier session; those implementers can't be messaged from here. Their work is in their worktrees, so review it there or brief a new implementer with what is left.";
  emit(
    "SessionStart",
    `${head} Below is the supervisor carry-over file (${carryOverRel}), written before the context was lost. ` +
      `It is the source of truth for in-flight work. Re-read docs/agents/supervised-workflow.md and HANDOFF.md ` +
      `if you need the rules or the queue, then continue from "Next action". ${agentNote}\n\n${notes}`,
  );
}

try {
  if (mode === "nudge") nudge();
  else if (mode === "pre-compact") preCompact();
  else if (mode === "restore") restore();
} catch {
  // never block the session
}
process.exit(0);
