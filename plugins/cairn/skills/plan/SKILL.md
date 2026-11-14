---
name: plan
description: "Break the approved PRD into phases of parallel tasks, then approve the plan."
disable-model-invocation: true
allowed-tools:
  - "Bash(cairn next:*)"
  - "Bash(cairn status:*)"
  - "Bash(cairn new:*)"
  - "Bash(cairn product:*)"
  - "Bash(cairn decide:*)"
  - "Bash(cairn approve:*)"
  - "Bash(cairn advance:*)"
  - "Bash(cairn plan:*)"
  - "Bash(cairn ready:*)"
  - "Bash(cairn task:*)"
  - "Bash(cairn phase:*)"
  - "Bash(cairn suggest:*)"
  - "Bash(cairn review:*)"
  - "Bash(cairn index:*)"
  - "Bash(cairn evidence:*)"
  - "Bash(cairn drift:*)"
  - "Bash(cairn pause:*)"
  - "Bash(cairn resume:*)"
  - "Bash(cairn close:*)"
  - "Bash(cairn render:*)"
  - "Bash(cairn migrate:*)"
  - "Bash(cairn escalate:*)"
  - "Bash(cairn level:*)"
  - "Bash(cairn test:*)"
  - "Bash(cairn linear:*)"
---

Plugin root: `${CLAUDE_PLUGIN_ROOT}`. If that shows a `${…}` placeholder instead of a real path, you are not in Claude Code (in Codex, for example). Then the plugin root is the folder two levels above this SKILL.md, the arguments are what the user asked for along with this skill, and every `cairn` command means `<plugin root>/bin/cairn`: run it by that full path, since a `cairn` on PATH may be another host's older copy. Read `<plugin root>/references/hosts.md` before the procedure: it says how to ask the user, run agents, and get approvals on this host, and that approvals always go through the user's own terminal there.

Read `${CLAUDE_PLUGIN_ROOT}/references/reporting.md` before talking to the user.

Read `${CLAUDE_PLUGIN_ROOT}/procedures/plan.md` and follow it exactly, step by step, finishing each step's **Done when** before the next.

Procedure files are not variable-expanded: wherever one says `CLAUDE_PLUGIN_ROOT`, use this path: `${CLAUDE_PLUGIN_ROOT}`.

Arguments: $ARGUMENTS
