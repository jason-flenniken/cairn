---
name: execute
description: "Run the current phase: parallel tasks, review, fix, merge."
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
---

Read `${CLAUDE_PLUGIN_ROOT}/references/reporting.md` before talking to the user.

Read `${CLAUDE_PLUGIN_ROOT}/procedures/execute.md` and follow it exactly, step by step, finishing each step's **Done when** before the next.

Procedure files are not variable-expanded: wherever one says `CLAUDE_PLUGIN_ROOT`, use this path: `${CLAUDE_PLUGIN_ROOT}`.

Arguments: $ARGUMENTS
