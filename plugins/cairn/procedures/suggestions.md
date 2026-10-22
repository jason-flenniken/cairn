# Suggestions

Show the recommended follow-ups collected across plans, then act on one if the user wants.

Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. List
Run `cairn suggest list --open`. A follow-up is open until it is resolved, merged into another, declined twice, or 60 days old (then it expires on its own). Show the result grouped by area, one line each, with its `<slug>:<id>`. When it is empty, say so in one line and stop.

**Done when:** the user has seen the open suggestions.

Items marked `[hardening]` are an MVP plan's hardening list. Don't merge them with ordinary follow-ups (cairn refuses), and dismiss one only when the user explicitly chooses to.

## 2. Choose
Ask with AskUserQuestion, naming the suggestion (offer the first few when there are many): Start a fix for it (Recommended) / Add it to the current plan / Dismiss it / Nothing now.
- **Start a fix:** follow `procedures/fix.md` for it, with the suggestion text as the bug or task. After the fix plan exists, run `cairn suggest resolve <slug>:<id> --note "fixed in <new plan slug>"` from the new plan.
- **Add it to the current plan:** only when a plan is in its plan stage or can be re-planned. Add a task to `plan.md` (own scope, a Check line), run `cairn plan load` (or `--replan` with the user's go-ahead), then `cairn suggest resolve <slug>:<id> --note "added as task <task id>"`.
- **Group some:** when several are related, `cairn suggest merge <key> <key>... --area <a> --text "<high-level item>"` from the current plan's worktree.
- **Dismiss:** ask for a one-line reason, then `cairn suggest resolve <slug>:<id> --dismiss --note "<reason>"`. This needs a plan branch: run it from the current plan's worktree.

**Done when:** the user chose, and the suggestion is resolved or left open on purpose.
