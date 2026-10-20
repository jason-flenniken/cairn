---
name: new
description: "Start a new cairn plan: title, slug, repo config, branch and worktree."
disable-model-invocation: true
allowed-tools: Bash(cairn:*)
---

Read `${CLAUDE_PLUGIN_ROOT}/references/reporting.md` before talking to the user.

Read `${CLAUDE_PLUGIN_ROOT}/procedures/new.md` and follow it exactly, step by step, finishing each step's **Done when** before the next.

Procedure files are not variable-expanded: wherever one says `CLAUDE_PLUGIN_ROOT`, use this path: `${CLAUDE_PLUGIN_ROOT}`.

Arguments: $ARGUMENTS
