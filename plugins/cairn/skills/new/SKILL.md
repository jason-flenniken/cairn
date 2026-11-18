---
name: new
description: "Start a new cairn plan: title, slug, repo config, branch and worktree."
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
  - "Bash(cairn step:*)"
  - "Bash(cairn prove:*)"
  - "Bash(cairn pr:*)"
  - "Bash(cairn merge-check:*)"
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
  - "Bash(cairn system:*)"
---

Plugin root: `${CLAUDE_PLUGIN_ROOT}`. If that shows a `${…}` placeholder instead of a real path, you are not in Claude Code (in Codex, for example). Then the plugin root is the folder two levels above this SKILL.md, the arguments are what the user asked for along with this skill, and every `cairn` command means `<plugin root>/cli/bin/cairn`: run it by that full path, since a `cairn` on PATH may be another host's older copy. Read `<plugin root>/references/hosts.md` before the procedure: it says how to ask the user, run agents, and get the PRD approval on this host, and that it always goes through the user's own terminal there.

Read `${CLAUDE_PLUGIN_ROOT}/references/reporting.md` before talking to the user.

Read `${CLAUDE_PLUGIN_ROOT}/procedures/new.md` and follow it exactly, step by step, finishing each step's **Done when** before the next.

Procedure files are not variable-expanded: wherever one says `CLAUDE_PLUGIN_ROOT`, use this path: `${CLAUDE_PLUGIN_ROOT}`.

Arguments: $ARGUMENTS

The arguments are the plan's description, not instructions to act on now: nothing runs before the plan exists (the procedure's "Nothing before the plan exists" rule).

The arguments may name Linear issues: a key (`SAV-100`), keys (`SAV-101,SAV-102`), a Linear issue URL, `milestone:"…"` or `project:"…"`, with or without `--from-linear` in front. Pull those issues into the plan (procedure step 2a).
