---
name: next
description: "Continue the current cairn plan from wherever it stands. The one command to remember."
disable-model-invocation: true
allowed-tools: Bash(cairn:*)
---

Read `${CLAUDE_PLUGIN_ROOT}/references/reporting.md` before talking to the user.

Run `cairn next --json`. If `cairn` is not on PATH, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs" next --json`.

The result names a `procedure` file. Read that file and follow it exactly, step by step, finishing each step's **Done when** before the next. Templates live in the `templates/` folder next to its `procedures/` folder.

On a branch with no active plan, the result routes to the new-plan procedure.

Procedure files are not variable-expanded: wherever one says `CLAUDE_PLUGIN_ROOT`, use this path: `${CLAUDE_PLUGIN_ROOT}`.

Arguments: $ARGUMENTS
