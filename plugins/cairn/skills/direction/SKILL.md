---
name: direction
description: "Check the build against the PRD: report only, no approval, no edits."
disable-model-invocation: true
allowed-tools: Bash(cairn:*)
---

Read `${CLAUDE_PLUGIN_ROOT}/references/reporting.md` before talking to the user.

Read `${CLAUDE_PLUGIN_ROOT}/procedures/direction.md` and follow it exactly, step by step, finishing each step's **Done when** before the next. This command is report-only: it writes no report file and records nothing.

Procedure files are not variable-expanded: wherever one says `CLAUDE_PLUGIN_ROOT`, use this path: `${CLAUDE_PLUGIN_ROOT}`.

Arguments: $ARGUMENTS (`all`, `changed`, or requirement ids; empty means `all`)
