---
name: fix
description: "Fix one bug on a fix-track plan: failing repro, the fix, a review, short record."
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

Read `${CLAUDE_PLUGIN_ROOT}/references/reporting.md` before talking to the user.

Read `${CLAUDE_PLUGIN_ROOT}/procedures/fix.md` and follow it exactly, step by step, finishing each step's **Done when** before the next.

Procedure files are not variable-expanded: wherever one says `CLAUDE_PLUGIN_ROOT`, use this path: `${CLAUDE_PLUGIN_ROOT}`.

Arguments: $ARGUMENTS

The arguments may be a Linear issue key (`SAV-123`) in place of a bug description: the fix plan then imports that issue (procedure step 2).
