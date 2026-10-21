# Status

Show where every plan stands.

Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Gather
Run `cairn status --all --json` when the user asked for everything or the session is not on a plan branch. Otherwise run `cairn status --json` for the current plan. With the argument `all`, always use `--all`.

**Done when:** you hold the status data.

## 2. Present
Per plan, give these lines, using names rather than ids:
- **Where:** stage, and the phase when executing; paused or running.
- **Done:** phases and tasks complete, as counts and names.
- **Next:** the next action (`cairn next --json` for the current plan).
- **Blocked:** blocked tasks with their note.
- **Drift:** unacknowledged edits outside task scopes, by path.
- **Pending stops:** the approval waiting on the user (PRD, plan, phase, ship), if any.

For several plans, use one compact block per plan, the one needing the user first. Leave out lines with nothing to say.

**Done when:** each plan has its lines and any pending stop is stated first.

## 3. Offer the way forward (only when not on a plan branch)
Ask with AskUserQuestion: one option per active plan, "Resume <title>". Put the plan that is waiting on the user first, marked "(Recommended)". Add a last option, "Start a new plan".
- Resume: run `cairn resume <slug>`. It prints the plan's worktree path, creating the worktree if needed. Call the EnterWorktree tool with that path. If EnterWorktree is unavailable, give the user `cd <path> && claude`, then `/cairn:resume`.
- New: follow `procedures/new.md`.

**Done when:** the session is in the chosen plan's worktree, or the new-plan procedure is running, or the user has the two-line instruction.
