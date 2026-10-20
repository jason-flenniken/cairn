---
name: plan
description: "Slice the approved PRD into phases and parallel slices, then approve the plan."
disable-model-invocation: true
allowed-tools: Bash(cairn:*)
---

Read `${CLAUDE_PLUGIN_ROOT}/references/reporting.md` before talking to the user.

Read `${CLAUDE_PLUGIN_ROOT}/procedures/plan.md` and follow it exactly, step by step, finishing each step's **Done when** before the next.

Procedure files are not variable-expanded: wherever one says `CLAUDE_PLUGIN_ROOT`, use this path: `${CLAUDE_PLUGIN_ROOT}`.

Arguments: $ARGUMENTS
