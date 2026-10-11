@AGENTS.md

## Claude Code specifics

The shared project instructions are in `AGENTS.md`, imported above. Add new rules there so Codex and other agents see them too; keep this file to what only applies to Claude Code.

- **Implementer sub-agents:** in the supervised workflow, launch each implementer with the Agent tool as `subagent_type: "general-purpose"`, `model: "sonnet"`, `run_in_background: true`.
