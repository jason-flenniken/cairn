---
name: resume
description: "Resume a paused plan with a short recap and its next action."
disable-model-invocation: true
allowed-tools: Bash(cairn:*)
---

Read `${CLAUDE_PLUGIN_ROOT}/references/reporting.md` before talking to the user.

Read `${CLAUDE_PLUGIN_ROOT}/procedures/resume.md` and follow it exactly, step by step, finishing each step's **Done when** before the next.

Procedure files are not variable-expanded: wherever one says `CLAUDE_PLUGIN_ROOT`, use this path: `${CLAUDE_PLUGIN_ROOT}`.

Arguments: $ARGUMENTS
