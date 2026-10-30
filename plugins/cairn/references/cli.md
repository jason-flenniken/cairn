# cairn CLI contract

The CLI is the **only writer** of plan state. Procedures and agents never edit `state.json`, `STATUS.md`, or `INDEX.md` by hand. Invoke it as `cairn <command>`. The plugin's `bin/` is on PATH for the Bash tool; if `cairn` is not found, use `node "<plugin root>/dist/cairn.mjs"`.

Every command accepts `--json`. Exit codes:
- `0`: ok
- `2`: **refused**. A checkpoint's evidence is missing. The output names what's missing and the exact command that fixes it.
- `1`: error

Refusable commands accept `--override "reason"`. The override is logged in state with its reason and source, and shown at the next stop. It needs human proof (see Human proof below). Never pass `--override` on your own initiative: only when the user explicitly chose it through an Override menu.

## Human proof
`cairn approve prd|plan|ship` and any command run with `--override` succeed only with human proof. Each recorded approval or override notes its source.
`cairn level mvp|standard|polished` needs the same human proof as an approval, through the same routes (the same level again needs none).
- **Mod menu (`source: mod`).** The session's mod asks through AskUserQuestion and runs the approval when the user picks "Approve (Recommended)". The pane's Approve button and `/cairn-approve` run it the same way.
  - The mod keeps the secret in memory only. On disk, `<git common dir>/cairn/mod-secret.sha256` (mode 0600) holds the secret's SHA-256 as lowercase hex.
  - The mod passes the secret to the CLI in `CAIRN_APPROVER`. The CLI hashes it and compares. On a match the CLI claims and deletes the hash file, so a used secret can't be replayed. The mod then writes a fresh secret and hash.
  - The hash file doesn't exist until the first approval or override.
- **Terminal (`source: terminal`).** Run `cairn approve <kind> --human` in your own terminal. It needs a TTY on stdin and stdout, and you type the plan slug at the prompt. Without a TTY it exits 2 and says to run it in your terminal. Agents can't supply this proof.
- **Mod-run override (`--override` only).** When the user picks "Override" on an Override menu (question tagged `[cairn:override <slug>]`), the mod holds a pending override for that plan in memory for 10 minutes. Nothing is written to disk.
  - The model then runs `cairn <command> --override "<reason>"` as a plain command, alone: no `cd`, no `&&`. The mod runs it itself with the secret and returns the CLI's output as the tool result.
  - The mod picks the plan whose worktree the session is in, or the one plan holding a pending override.
  - The mod runs the command as written only when it holds none of ``; | & $ ` > <``, a newline, or a backslash, and no unquoted `# * ? ~ ( ) { } [ ]`. Otherwise it doesn't run it and says why. A command that includes `approve` is never run this way.
  - A failed override's output starts with `Exit code N`.

**Procedures never run `cairn approve`.** They ask the user through a tagged menu, or tell the user to run `cairn approve <kind> --human` when the mod is not active. Either way they confirm the result with `cairn status --json`.

### Mod heartbeat and `modActive`
`<git common dir>/cairn/mod-heartbeat` holds one value: epoch milliseconds as plain decimal text, with no newline (for example `1792532987012`). The mod writes it at session start and every 2 seconds after that.

`modActive` is `true` when that value is under 10 seconds old. It appears in `cairn status --json`, `cairn status --all --json`, and `cairn next --json`. When it is `false`, the menu can't record an approval, so procedures switch to the terminal command.

### Mod commands
The mod registers these commands. Their names have no ":" because the engine forbids it.
- `/cairn-pane [on|off]`: shows or hides the pane; no word toggles. The choice is kept across sessions, and a hand close turns it off.
- `/cairn-approve [kind]`: approves the stop waiting on the session's plan.
- `/cairn-level`: asks MVP, Standard or Polished for the session's plan and runs `cairn level` with the mod's proof. It offers only levels the CLI would accept.
- `/cairn-pause-now`: stops the running turn and pauses the plan now (Stop now).
- `/cairn-pause-mod`: pauses the plan once in-flight work reaches a safe point.
- `/cairn-resume-mod [plan]`: resumes a paused plan, here or after `/clear`.

## Where things live
- Plan branch (from `cairn status --json`, `state.branch`): `feature/<slug>` for a feature plan, `fix/<slug>` for a fix. It is usually checked out in its own worktree. The orchestrator session stays at the repo root and runs `cd <plan worktree> && cairn <command>`.
- Plan dir, committed on the plan branch: `docs/cairn/plans/<date>-<slug>/` (the date is the plan's start; `cairn status --json` gives the absolute path as `dir`; older plans keep the undated `<slug>` folder and are still found), containing:
  - `decisions.md`: append-only, written via `cairn decide`
  - `prd.md`, `plan.md`, `handoff.md`, `RECORD.md`: written by procedures from `templates/`
  - `changelog.md`: the plan's changelog entry, one paragraph of at most 120 words (what was built, why, the big rocks), written by the recorder at ship
  - `direction/<phase-id>.md`: one direction report per phase, with its `cairn-direction` scorecard
  - `state.json`, `STATUS.md`: CLI only
- Task branches: `task/<slug>/<task>`, each in its own worktree, in a folder named after the plan folder plus `--<task>`. Task workers never touch `docs/cairn/`.
- Product track, on main: `docs/cairn/product/PRD.md` and `docs/cairn/product/decisions/`.
- Repo config: `.cairn/config.json` (falls back to `.sdlc/config.json`; when both exist `.cairn` wins and `cairn status` warns), with keys:
  - `setup`: run in every new plan or task worktree, for example to install dependencies
  - `test`, `build`, `start`, `seed`, `appTypes`, `maxParallel`, `worktreeRoot`, `autoCommit`
  - `resumeFreshAfterMinutes`: how long a pause counts as recent before resume offers a clean start (default 60)
  - `fixMaxFiles`: how many files a fix may change before `task done fix` refuses and names `escalate` (default 8)
  - `audit`: the dependency audit command the check stage runs (a string). When absent, the check stage detects the stack's native audit from the lockfile
  - `reproTimeoutMinutes`: how long `cairn repro` may run (default 10)
- Config lock (FR-32): plan approval records a hash of the `setup`, `test`, and `build` commands. On the fix track the hash is taken when the repro is recorded. `task start`, `task done`, `repro`, and `close` refuse while the hash differs, and name the fix: the user re-approves the plan, or chooses Override.
- The active plan is decided by the current git branch. A branch counts as a plan only when it holds `docs/cairn/plans/<date>-<slug>/state.json`; hand-made `feature/` branches are ignored. On any other branch the CLI works on the index of all plans. Plans created before the `feature/`, `fix/`, and `task/` names keep `sdlc/<slug>`, `sdlc-task/<slug>/<task>`, and `sdlc-<slug>` folders, finish under those names, and cairn still recognises them.

## Stages
`discover → prd → plan → execute → verify → review → ship → learn → closed`

The fix track (`cairn new <slug> --track fix`) is shorter and has no learn stage: `repro → execute → review → ship → closed`. See Fix track below.

| Command | Gate (refused unless…) |
|---|---|
| `cairn advance` (to prd) | `decisions.md` has at least one decision |
| `cairn approve prd` | stage is prd, `prd.md` has the five required sections (Problem, Solution, Requirements, Non-goals, Open questions), and Open questions has no unchecked `- [ ]` items |
| `cairn advance` (to plan) | PRD approved |
| `cairn plan load` | `plan.md` has Goal, Architecture and Phases and a valid `cairn-tasks` YAML block: unique ids, `blocked_by` only to the same or an earlier phase, no cycles, non-empty `scope`, `covers` ids exist in the PRD, and every PRD `FR-` id is covered or listed under `## Deferred requirements` |
| `cairn approve plan` | the plan is loaded and `plan.md` is unchanged since it was loaded. If `prd.md` changed after the PRD was approved, this approval also accepts those edits (the PRD approval takes the new text's hash), and the plan's approval card and the `status` warning say so. `cairn approve prd` works only at the prd stage |
| `cairn advance` (to execute) | plan approved |
| `cairn task start <id>` | the task is in the ready set (`cairn ready`), and the config lock holds |
| `cairn task done <id>` | the task branch is merged into the plan branch, the config `test` command passes in the plan worktree (a missing test command is a warning, not a refusal; at MVP a red suite is a warning plus a hardening item), the config lock holds, and on feature plans no non-merge commit made directly on the plan branch since the task started changes files in the task's scope (outside `docs/cairn/`). That refusal lists the short SHAs: move them onto the task branch and merge it with `--no-ff` |
| `cairn evidence phase` | (on demand) the phase's direction report has one valid `cairn-direction` block with a row for every covered requirement |
| `cairn phase finish` | every task in the current phase is done, nothing is blocked or paused, the plan worktree is clean, tests are green at the current commit (the last `task done` run is reused when no code changed), and no on-track check for the phase is red. No human step |
| (last phase finished) | stage moves to verify automatically |
| `cairn advance` (to review) | `cairn evidence verify pass` recorded |
| `cairn advance` (to ship) | `cairn evidence review pass` recorded with no blocking findings |
| `cairn approve ship` | `RECORD.md` has its six sections (Links, Why, What was built, How it works, Findings, Follow-ups) and is within 600 words. The approval records the plan branch's HEAD (`approvals.ship.sha`). After ship it is accepted only to approve again, when `cairn merge-check` cleared the approval |
| `cairn advance` (to learn) | ship approved |
| `cairn close` | stage is learn, `RECORD.md` is valid, tests pass, and the config lock holds |

## Commands
- **Routing and status**
  - `cairn next [--json]`: what to do now. Returns `{stage, substep, procedure: <abs path>, summary, plan}`. Read and follow the procedure file it names.
  - `cairn status [--all] [--json]`: one plan, or every plan with `--all`, read live from each worktree.
- **Plans**
  - `cairn new <slug> --title "…" [--track feature|fix] [--level mvp|standard|polished] [--from <ref>] [--no-worktree]`: creates the branch, the worktree, the plan dir, and state, and prints the worktree path. `--level` defaults to config `defaultLevel`, then Standard; fix plans have no level.
  - `cairn migrate`: moves a repo from `.sdlc/` and `docs/sdlc/` to `.cairn/` and `docs/cairn/` with `git mv`, then commits "cairn: move .sdlc to .cairn and docs/sdlc to docs/cairn". Run it on main, outside any plan, with no plan in flight and a clean tree. Folders that already exist are merged; it refuses only when the same file exists on both sides. Legacy `docs/sdlc/plans/` is still read (in checkouts and on branches) but never written, and the session-start hook hints at `cairn migrate` when a repo still has the old folders and no plan is active.
  - `cairn product init`: creates `docs/cairn/product/` from templates, on the current branch.
  - `cairn decide "<question>" "<answer>" [--why "…"]`: appends to `decisions.md`.
  - `cairn decide --file <path>`: reads the decision from a JSON file, `{question, answer, why?}`.
- **Project memory**
  - `cairn index`: the short changelog that session start also receives: the five newest closed plans (`- <date> <title>: <entry>`), each entry cut to 120 words, then `Older work: docs/cairn/OVERVIEW.md`. A plan with no `changelog.md` shows the first sentence of its record's Why. Prints nothing when no plan is closed.
  - Removed in 0.7.0: `/cairn:map`, the area-doc commands, the memory lookup command, and the lasting-decision flags on `cairn decide`. Each refuses (exit 2) with "<what> was removed; the changelog in docs/cairn/OVERVIEW.md replaces it." Existing `docs/cairn/system/` and `docs/cairn/decisions/` folders are no longer read, and cairn never deletes them.
  - `--note-file <path>`: works on any command that takes `--note`, and reads the note from the file.
  - Prefer `--file` and `--note-file` for text with quotes, apostrophes, or backticks, so the shell never parses it.
- **Stage transitions**
  - `cairn approve prd|plan|ship [--note "…"]`: through the mod's menu, or `--human` in the user's terminal (see Human proof)
  - `cairn advance [--to <stage>]`
  - `cairn level mvp|standard|polished [--human]`: changes a feature plan's level, with the human proof above. It refuses on the fix track, while paused, at ship, learn or closed, and for a lower level once any task has started. Refusals come before the proof is spent. A raise clears plan approval if no task has started, clears recorded Check and review results (a plan in review goes back to Check), and files one hardening item per finished task built below the new level.
- **Merging**
  - `cairn merge-check [--json]`: run from the plan worktree right before merging the PR, after the ship approval (at ship, learn or closed). In order:
    - It refuses on uncommitted changes outside the plan folder.
    - It fetches `origin/<base>` and refuses when the fetch fails, so it never checks against a stale base. With no `origin` remote it checks the local base and says so.
    - It refuses when the plan branch is already in the base (the PR was merged).
    - It walks the plan branch's first-parent commits since `approvals.ship.sha`. Commits that touch only the plan folder, what a close writes (`docs/cairn/OVERVIEW.md`, and the old `docs/cairn/decisions/` and `docs/cairn/system/`) or `REVIEW.md`, and the clean merges it made itself (`baseMerges`), are covered. Anything else (a code commit, or a merge it did not make, such as one resolved by hand) clears the approval, sets `reapprove: {at, why}`, and refuses. The plan then shows `ready.kind: "ship"` and `next` says to approve again, even when closed.
    - When the base moved, it merges it in with `--no-ff`. A conflict only in what a close writes is settled by taking the base's side and regenerating `OVERVIEW.md`, and counts as a clean merge. Any other conflict aborts the merge (nothing changes) and refuses with the conflicted files. A clean merge is recorded in `baseMerges`.
    - It runs the `test` command unless the tests already passed at a check on this code: `mergeChecked` is the last head they passed on, and only plan-folder commits since it skip them. A red run refuses (a clean merge stays), and the next run tests again.
    - It prints the HEAD it checked: merge with `gh pr merge --match-head-commit <sha>`. JSON: `{head, base, merged, behind, tests, notes[]}`.
    - Plans approved before 0.10.0 have no `approvals.ship.sha`; their changes since the approval are not checked, and a note says so.
  - `cairn trace <path>:<start>[-<end>] [--base <branch>] [--json]`: read-only. Blames the lines as they stand on the base (the local base, else `origin/<base>`; the plan's base, else `main`), then names each commit, the first commit on the base's first-parent line that brought it in, the PR number, the plan (from a `feature/`, `fix/` or `sdlc/` branch name, or a RECORD.md that links the PR, for squash merges), that plan's record, and the task (the nearest `merge task <id>` above the commit). JSON: `{commits: [{sha, date, subject, landed?, pr?, plan?, record?, task?}], base}`.
- **Plan and tasks**
  - `cairn plan load [--replan]`: parses `plan.md` into state. Use `--replan` during execute, for example to change later phases. Existing task progress is kept, the stage returns to plan, the plan needs approval again, and verify and review evidence is cleared.
  - `cairn ready [--json]`: tasks that can start now (blockers done, no scope overlap, under the parallel cap).
  - `cairn task start <id>`: creates the task worktree and branch, and prints the path. On a fix plan at review, `cairn task start fix` reopens the fix (see Fix track).
  - `cairn task step <id> implementing|reviewing|fixing|merging|blocked [--note "…"]`: `fixing` increments the fix attempt. After 2 attempts it is refused: stop and ask the user.
  - `cairn task done <id>`
  - `cairn step <name> [--count N]`: records what the current stage is doing, shown as "Review · fixing 3 findings" in `cairn status`, STATUS.md and `status --json` (`state.step`). The step clears when the stage changes. While the step is `drafting`, `checking` or `recording`, the stop's document is still being written, so `ready` stays empty and the pane offers no approval. Names by stage:
    - prd and plan: `drafting` (writing the document), `checking` (the builder check), `approving`;
    - check: `testing` (running tests), `scanning` (scanning for secrets), `fixing`;
    - review: `reviewing`, `fixing`, `rechecking`;
    - ship: `recording` (writing the record and changelog entry), `approving` (waiting on approval), `opening-pr`.
    - The fix track uses review and ship. A name not valid for the current stage exits 2 and lists the valid ones. `--count` is a whole number, shown with `fixing` ("fixing 3 findings").
  - `cairn test`: runs the configured test command in the plan worktree and prints the result. At MVP a red run files one hardening item per command (a repeat only logs, a green run resolves it) and the command still succeeds; at Standard and Polished a red run is only reported. `status --json` lists the open failing-suite items as `knownFailures`.
  - `cairn phase finish`: finishes the current phase with no human proof and prints one summary line (tasks, tests, new suggestions, out-of-scope edits). It opens the next phase, or moves the plan to Check after the last one.
- **Suggestions**
  - `cairn suggest add --area tests|security|perf|quality|ux|docs [--where <glob>]... (--text "…" | --text-file <f>) [--from task-review|branch-review|check|implementer|plan|user|mvp|security-review] [--kind hardening]`: appends to the current plan and prints `<slug>:<id>`. `--kind hardening` files a hardening item (what an MVP plan leaves untested, unreviewed or failing): it needs at least one `--where`, defaults `--from` to `mvp`, never expires, and does not count toward the 5-open limit on close or the open follow-up count; `status --json` reports them as `hardeningItems`. It is otherwise a follow-up: `suggest list --for` matches it and `records` lists it.
  - `cairn suggest list [--open] [--for <glob>]... [--json]`: all plans (worktrees, plan branches, closed plans in this checkout), grouped by area. `--for` keeps suggestions whose `where` overlaps the globs.
  - `cairn suggest resolve <slug>:<id> [--dismiss] [--note "…"]`: closes a suggestion from the current plan.
  - `cairn suggest merge <key> <key>... --area <a> [--where <glob>]... --text "…"`: groups open follow-ups into one new item in the current plan (its `where` defaults to theirs combined). The grouped ones become `merged`.
  - `cairn suggest decline <key>...`: records one decline of each open follow-up. The second decline expires it.
  - Each listed follow-up has a derived `status` in `suggest list --json`: `open`, `closed` (resolved or dismissed), `merged`, or `expired` (declined twice, or older than 60 days). `open` is true only for `open`.
  - `cairn close` refuses when more than 5 open follow-ups come from the plan, and names them.
- **Evidence and out-of-scope edits**
  - `cairn evidence verify|review pass|fail [--note "…"] [--blocking N]`
  - `cairn evidence phase [--note "…"]`: reads the phase's direction report and its one ` ```yaml cairn-direction ` block, the direction scorecard. The scorecard has three lists: `requirements`, `nfr`, and `unplanned`.
    - Each `requirements` and `nfr` row has `id`, `verdict` (`aligned`, `partial`, `missing`, or `contradicted`), `evidence` as `path:line`, and an optional `note`.
    - Each `unplanned` row has `what`, `class` (`pulled-forward`, `unplanned`, `non-goal-breach`, or `supporting`), and `evidence` as `path:line`.
    - The CLI computes the color (green, yellow, or red) from the rows and records it with the commit. Agents never state the color. It refuses an invalid scorecard.
  - `cairn drift ack <path|--all> [--note "…"]`
- **Fix track**
  - `cairn repro "<command>"`: runs the command in the plan worktree under `reproTimeoutMinutes`. A non-zero exit means the repro shows the bug: it is recorded and the stage becomes execute. Exit 0, a timeout, or a command that can't start is refused.
  - `cairn escalate`: turns a fix plan into a feature plan at stage prd. Use it when `task done fix` refuses for too many files, or the fix needs a requirement the bug report didn't state.
- **Pause, resume, close**
  - `cairn pause [--now]`: requires `handoff.md` with In flight / Open questions / Next action sections.
  - `cairn resume`: clears the pause and prints a recap: status, the handoff, and the next procedure.
  - `cairn close`: after closing it rewrites `docs/cairn/OVERVIEW.md` from each closed plan's `changelog.md` and commits it as "cairn(<slug>): update changelog". If that fails, the close still succeeds with a warning to run `cairn render` on main. A fix plan's `cairn advance` from ship does the same.
- **Generated docs and hooks**
  - `cairn render`: on a plan, regenerates `STATUS.md`. Off a plan it does not touch `STATUS.md`; it writes `docs/cairn/OVERVIEW.md`, the changelog, newest first.
  - `cairn records [--json]`: lists every plan, in-progress first then closed newest first, with date, title, why line, changelog entry, record path and follow-ups. Works from any worktree.
  - `cairn hook session-start|post-edit`: used by `hooks/hooks.json`. Reads hook JSON on stdin.

The CLI commits the plan dir on the plan branch only at transitions: approve, advance, plan load, task done, phase finish, pause, resume, close, and merge-check.

## Fix track
`cairn new <slug> --track fix` starts a plan at stage repro.
1. `cairn repro "<command>"` records a failing repro and moves the plan to execute.
2. `cairn advance` creates the single task `fix` (scope `**`). Build it as in `procedures/execute.md`.
3. `cairn task done fix` moves the plan to review. It refuses when more than `fixMaxFiles` files changed and names `cairn escalate`.
4. A review pass with no blocking findings moves the plan to ship. `cairn approve ship` and `cairn advance` then close it.

A blocking review finding has two exits. `cairn task start fix` reopens the task from review: the plan returns to execute, the review result is cleared, and the repro and the task base are kept. `cairn escalate` turns the plan into a feature plan at stage prd.

## JSON shapes (`--json`)
- `next`: `{ok, plan, stage, substep, procedure, summary, text, warnings[], planWorktree, modActive}`. On a non-plan branch: `{plan: null, procedure, plans[], modActive}`.
- `status`: `{ok, state, next, ready?, warnings[], task, planWorktree, modActive, openSuggestions}`.
  - `ready` is present only when approving the current stop would pass its checks: `{kind: "prd"|"plan"|"ship", file, summary}`. `file` is the absolute path of the document; `summary` is a short markdown excerpt.
  - `state` is the full state.json: `phases[].tasks[]` with `id`, `name`, `status`, `substep`, `fixRound`, `worktree`, `branch`, `scope`, `covers`, `blockedBy`, `complexity`, plus `paused`, `approvals` (`approvals.ship.sha` is the HEAD the ship approval covered), `reapprove?` (set when code changed after the ship approval), `baseMerges?` (clean base merges `merge-check` made), `mergeChecked?` (the last head `merge-check` saw the tests pass on), `evidence`, `drift[]`, `suggestions[]`, and `log[]`. A task also has `risky`, `riskReason`, and `startedAt`.
  - `status --all`: `{plans: [{state, live, worktree, next, ready?}], modActive, openSuggestions}`.
- `records`: `{records: [{slug, title, date, stage, why, entry?, record?, followUps: [{text, area, status}]}]}`. In-progress plans first, then closed plans newest first. Reads the main checkout from any worktree.
- `ready`: `{paused, phase, phaseStatus, ready: [task + model], inProgress: [task], waiting: [{id, on[]}]}`.
- `task start`: `{worktree, branch, planBranch}`.
- `new`: `{slug, branch, base, worktree, dir}`.
- `resume <slug>` from another branch: `{worktree, switchRequired: true}`. `resume` on the plan: `{procedure, handoff}`.
- Refusal (exit 2): `{ok: false, refused, fixes[]}`.
