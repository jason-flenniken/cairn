# cairn CLI contract

The CLI is the **only writer** of plan state. Procedures and agents never edit `state.json`, `STATUS.md`, or `INDEX.md` by hand. Invoke it as `cairn <command>`. The plugin's `bin/` is on PATH for the Bash tool; if `cairn` is not found, use `node "<plugin root>/dist/cairn.mjs"`.

Every command accepts `--json`. Exit codes:
- `0`: ok
- `2`: **refused**. A checkpoint's evidence is missing. The output names what's missing and the exact command that fixes it.
- `1`: error

Refusable commands accept `--override "reason"`. The override is logged in state and shown at the next stop. Never pass `--override` on your own initiative: only when the user explicitly chose it.

## Where things live
- Plan branch: `sdlc/<slug>`, usually checked out in its own worktree.
- Plan dir, committed on the plan branch: `docs/sdlc/plans/<slug>/`, containing:
  - `decisions.md`: append-only, written via `cairn decide`
  - `prd.md`, `plan.md`, `handoff.md`, `RECORD.md`: written by procedures from `templates/`
  - `state.json`, `STATUS.md`: CLI only
- Slice branches: `sdlc-slice/<slug>/<slice>`, each in its own worktree. Slice workers never touch `docs/sdlc/`.
- Product track, on main: `docs/sdlc/product/PRD.md` and `docs/sdlc/product/decisions/`.
- Repo config: `.sdlc/config.json`, with keys `setup` (run in every new plan or slice worktree, for example to install dependencies), `test`, `build`, `start`, `seed`, `appTypes`, `maxParallel`, `worktreeRoot`, `autoCommit`.
- The active plan is decided by the current git branch: `sdlc/<slug>` or `sdlc-slice/<slug>/…`. On any other branch the CLI works on the index of all plans.

## Stages
`discover → prd → plan → execute → verify → review → ship → learn → closed`

| Command | Gate (refused unless…) |
|---|---|
| `cairn advance` (to prd) | `decisions.md` has at least one decision |
| `cairn approve prd` | stage is prd, `prd.md` has every required section, and Open questions has no unchecked `- [ ]` items |
| `cairn advance` (to plan) | PRD approved |
| `cairn plan load` | `plan.md` has the required sections and a valid `cairn-slices` YAML block: unique ids, `blocked_by` only to the same or an earlier phase, no cycles, non-empty `scope`, `covers` ids exist in the PRD, and every PRD `FR-` id is covered or listed under `## Deferred requirements` |
| `cairn approve plan` | the plan is loaded and `plan.md` is unchanged since it was loaded |
| `cairn advance` (to execute) | plan approved |
| `cairn slice start <id>` | the slice is in the ready set (`cairn ready`) |
| `cairn slice done <id>` | the slice branch is merged into the plan branch, and the config `test` command passes in the plan worktree |
| `cairn approve phase` | every slice in the current phase is done, and all drift is acknowledged (`cairn drift ack`) |
| (last phase approved) | stage moves to verify automatically |
| `cairn advance` (to review) | `cairn evidence verify pass` recorded |
| `cairn advance` (to ship) | `cairn evidence review pass` recorded with no blocking findings |
| `cairn approve ship` | `RECORD.md` has every section and is within its length budget |
| `cairn advance` (to learn) | ship approved |
| `cairn close` | stage is learn, `RECORD.md` is valid, and tests pass |

## Commands
- **Routing and status**
  - `cairn next [--json]`: what to do now. Returns `{stage, substep, procedure: <abs path>, summary, plan}`. Read and follow the procedure file it names.
  - `cairn status [--all] [--json]`: one plan, or every plan with `--all`, read live from each worktree.
- **Plans**
  - `cairn new <slug> --title "…" [--track feature|fix] [--from <ref>] [--no-worktree]`: creates the branch, the worktree, the plan dir, and state.
  - `cairn product init`: creates `docs/sdlc/product/` from templates, on the current branch.
  - `cairn decide "<question>" "<answer>" [--why "…"]`: appends to `decisions.md`.
- **Stage transitions**
  - `cairn approve prd|plan|phase|ship [--note "…"]`
  - `cairn advance [--to <stage>]`
- **Plan and slices**
  - `cairn plan load [--replan]`: parses `plan.md` into state. Use `--replan` during execute, verify, or review, for example to add fix slices. Existing slice progress is kept, the stage returns to plan, the plan needs approval again, and verify and review evidence is cleared, so both run again after the fixes are built.
  - `cairn ready [--json]`: slices that can start now (blockers done, no scope overlap, under the parallel cap).
  - `cairn slice start <id>`: creates the slice worktree and branch, and prints the path.
  - `cairn slice step <id> implementing|reviewing|fixing|merging|blocked [--note "…"]`: `fixing` increments the fix round. After 5 rounds it is refused, so escalate or re-plan.
  - `cairn slice done <id>`
- **Evidence and drift**
  - `cairn evidence verify|review pass|fail [--note "…"] [--blocking N]`
  - `cairn drift ack <path|--all> [--note "…"]`
- **Pause, resume, close**
  - `cairn pause [--now]`: requires `handoff.md` with In flight / Open questions / Next action sections.
  - `cairn resume`: clears the pause and prints a recap: status, the handoff, and the next procedure.
  - `cairn close`
- **Generated docs and hooks**
  - `cairn render`: regenerates `STATUS.md`, plus `docs/sdlc/INDEX.md` when on main.
  - `cairn hook session-start|post-edit`: used by `hooks/hooks.json`. Reads hook JSON on stdin.

The CLI commits the plan dir on the plan branch only at transitions: approve, advance, plan load, slice done, pause, resume, and close.

## JSON shapes (`--json`)
- `next`: `{ok, plan, stage, substep, procedure, summary, text, warnings[], planWorktree}`. On a non-plan branch: `{plan: null, procedure, plans[]}`.
- `status`: `{ok, state, next, warnings[], slice, planWorktree}`.
  - `state` is the full state.json: `phases[].slices[]` with `id`, `name`, `status`, `substep`, `fixRound`, `worktree`, `branch`, `scope`, `covers`, `blockedBy`, `complexity`, plus `paused`, `approvals`, `evidence`, `drift[]`, and `log[]`.
  - `status --all`: `{plans: [{state, live, worktree, next}]}`.
- `ready`: `{paused, phase, phaseStatus, ready: [slice + model], inProgress: [slice], waiting: [{id, on[]}]}`.
- `slice start`: `{worktree, branch, planBranch}`.
- `new`: `{slug, branch, base, worktree, dir}`.
- `resume <slug>` from another branch: `{worktree, switchRequired: true}`. `resume` on the plan: `{procedure, handoff}`.
- Refusal (exit 2): `{ok: false, refused, fixes[]}`.
