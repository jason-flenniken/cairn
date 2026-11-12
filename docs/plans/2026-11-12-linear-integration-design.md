# Linear integration for cairn: design direction

## Context

cairn has no Linear integration today. `docs/design.md:86` sketches a one-way mirror (plan → Linear project, phase → milestone, task → issue) plus `cairn new --from-linear`, but none of it was built. The sketch also points the wrong way for the intended use: large Linear projects holding dozens of tickets, worked through over many cairn plans. Mirroring each plan as its own Linear project would fill Linear with tiny projects.

The new direction: **Linear owns the backlog, cairn owns execution.** A cairn plan pulls a selection of Linear issues in, builds them, and writes progress back. A project-level board shows how a whole Linear project is moving across plans.

The Linear workspace ("savvyling", team SAV) is new and empty, so the design sets the conventions rather than following existing ones.

## Decisions made

| Question | Decision |
|---|---|
| How large work is grouped in Linear | Project → Milestones → Issues. Initiatives optionally sit above projects. |
| What one cairn plan covers | Any selection: an epic (a parent issue and its sub-issues), a milestone, some issues in a project, or a single issue. The epic is the natural unit when milestones are too big for one plan. |
| What each pulled-in issue becomes | One or more PRD requirements tagged with the key (`FR-2 … [SAV-102]`). Tasks are still split by file scope and list the requirements they cover. An issue is done when every task covering its requirements is merged. |
| What gets written back | Issue status, progress comments, project status updates (approved before posting), and open follow-ups as new Linear issues. |
| How cairn talks to Linear | Hybrid. The CLI tracks the links and queues the writes that are due; the agent sends them through the Linear MCP and marks them sent. Reads arrive as a JSON snapshot the CLI caches. No API key in cairn. |
| Project-level view | A progress board only, in the terminal and as a pane tab. Suggesting the next plans and back-filling a project from a PRD are out of scope for now. |

## Design

### 1. Opt-in config
`.cairn/config.json` gets an optional `linear` block: `{ "team": "SAV", "statuses": { "inProgress": "In Progress", "inReview": "In Review", "done": "Done" } }`. Status names are optional. By default cairn uses Linear's status *types* (`started`, `completed`), since status names differ per team. With no `linear` block, nothing in this design runs, and every existing test and flow is unchanged.

### 2. Pulling issues into a plan
- `/cairn:new` accepts a selection:
  - `--from-linear SAV-100` (an epic, if it has sub-issues; see section 3)
  - `--from-linear SAV-101,SAV-102`
  - `--from-linear milestone:"M1 Payments"`
  - `--from-linear project:"Checkout rewrite"`
- The `new` procedure has the agent fetch the issues through the MCP: their descriptions, comments, blocked-by relations, and parent and sub-issue links (`list_issues parentId`, level by level). It pipes that JSON to `cairn linear import`. The CLI validates it and stores it in the plan's state as `linear: { project, milestone?, epic?, issues: [{ key, title, url, milestone, parent?, blockedBy }] }`.
- Discover treats the issues as given facts: the interview doesn't re-ask what a ticket already says.
- The PRD template adds a rule: every requirement that comes from a ticket ends with `[SAV-n]`. `cairn approve prd` refuses unless every imported issue is tagged on at least one requirement or listed under a new `## Issues not taken` section, with a reason. Untaken issues are released back to Linear with a comment.
- The fix track gets the same thing for a single issue: `/cairn:fix SAV-123`.
- Branch names get the issue key when the plan covers exactly one issue (`feature/sav-101-card-form`). Linear's GitHub integration links the branch and PR by key. Check first that `locate.ts` slug parsing accepts this; slugs are kebab-case of at most 40 characters, so it should.

### 3. Epics: a parent issue with sub-issues
Linear has no epic type. A parent issue with sub-issues is the epic, and it is a first-class plan unit.

**What it maps to.**
- **The parent** gives the plan its goal. Its description seeds the PRD's Problem and Solution, and it is not a requirement by default. The parent is done when all its sub-issues are done. If the parent has acceptance criteria of its own, discover turns them into requirements tagged with the parent's key, like any other issue.
- **Each sub-issue** becomes requirements tagged with its key, as in section 2.
- **Nested sub-issues** come in with the whole subtree. Only leaf issues (and a parent with its own criteria) need requirement tags. The `approve prd` tagging check skips a parent with no criteria.

**An epic too big for one plan.**
- Discover shows the subtree with counts. When the epic is large (roughly more than about 8 leaf issues, or a spread that won't fit one PR), it offers to take a subset now: one branch of the subtree, or the sub-issues with no blockers.
- The rest go under `## Issues not taken` with the reason "later plan". In Linear they stay under the epic, untouched.
- Several plans can each own part of one epic, one after another or side by side when nothing blocks between them. The board groups them under the epic.

**Selection rules.**
- Picking a parent always brings its sub-issues, even when some sit in other milestones; discover says so.
- Picking a milestone that contains a parent brings that parent's sub-issues too, and discover lets the user drop any.
- Picking a single sub-issue does not bring its parent or siblings. The parent is recorded only for the board and for status write-back.

**Status write-back for the parent.**
- The parent moves to In Progress when the first plan covering any part of the epic reaches execute.
- It moves to Done only when every sub-issue is done, across all plans. When a plan ships its last open sub-issue, cairn queues a Done for the parent unless it's already closed. Linear's team setting that closes a parent automatically may do this first; a refresh sees that, and cairn skips the write.
- Progress comments go on the parent as well ("3 of 7 sub-issues shipped, plan feature/sav-100-checkout"), so the epic is readable in Linear without opening each child.

**Changes in Linear mid-plan.** A sub-issue added to an in-plan epic is caught on refresh, the same as a new dependency (section 6d). The user chooses: pull it in (amend the PRD and re-plan) or leave it for a later plan (`## Issues not taken`). A sub-issue moved out of the epic is noted and released.

**Parent links are not blocking links.** Order between sub-issues comes only from blocked-by links (section 6). A blocked-by link on the parent itself ("SAV-100 blocked by SAV-090") applies to every sub-issue in the plan.

### 4. Per-issue progress from existing state
Add a pure function, `issueProgress(state)`. For each linked issue it finds the FR ids tagged with that key (parsed from `prd.md`), then the tasks whose `covers` includes them, and returns `not started | in progress | built | shipped`. It reuses `Task.covers` and `Task.status` from `cli/src/types.ts` and the PRD requirement parsing in `plan-parse.ts`. Nothing new is stored for progress; it is derived.

### 5. Queue of Linear writes (the hybrid core)
- The state gains `linear.outbox: [{ id, kind, target, payload, queuedAt, sentAt?, ref? }]`. The kinds are `status`, `comment`, `statusUpdate` and `createIssue`.
- Existing transitions queue entries. No new decision points are added:

  | Moment | What gets queued |
  |---|---|
  | `approve prd` | A comment on each issue with a PRD link and the requirements it maps to. |
  | `advance` to execute | Status In Progress on each issue. |
  | `task done` | Nothing per task, to keep the noise down. |
  | `phase finish` | A comment on each issue that moved to "built" in this phase. |
  | Ship (PR opened) | Status In Review. A comment with the PR link. `Fixes SAV-n` lines go in the PR body. |
  | `merge-check` sees the PR merged | Status Done on shipped issues. |
  | `close` | A `createIssue` for each open follow-up (labeled `cairn-follow-up`, same project and milestone). A drafted project `statusUpdate` waits for the user to approve it with AskUserQuestion before it's sent. |

- New commands:
  - `cairn linear pending [--json]` lists unsent entries.
  - `cairn linear sent <id> [--ref <linear id/url>]` marks one sent. For `createIssue`, `--ref` records the new key on the suggestion so it is never created twice.
  - `cairn linear import` reads JSON from stdin.
  - `cairn linear board [--json]` prints the board (section 7).
- `cairn next` routes to a new `procedures/linear-sync.md` whenever there are unsent entries, ahead of the stage's own procedure, so writes aren't forgotten. The session-start hook prints the pending count. That procedure names the Linear tools by their base names (`save_issue`, `save_comment`, `save_status_update`), because the MCP prefix differs between installs. It also follows the server's rule of putting agent detail in a collapsed "Agent notes" block.
- A send failure leaves the entry unsent and is reported in one line. It never blocks a cairn transition.

### 6. Dependencies between issues
Issues become requirements, but tasks are split by code. So an issue dependency (SAV-102 blocked by SAV-101) has to be turned into task order on purpose; it doesn't carry over by itself. There are five cases.

**a. Known when the plan starts, both issues in the plan.**
- Import keeps every blocked-by link from Linear.
- The plan procedure orders phases by issue dependency layers. Issues with no blocker inside the plan go first; the issues they unblock come in later phases. For a milestone this gives the natural build order.
- `cairn plan load` gets a new check. Take an issue link A → B. Each task covering B's requirements (and none of A's) must depend, directly or through other tasks, on every task covering A's. Otherwise load refuses and names the task pair and the fix (add a `blocked_by` or move the task to a later phase).
- Escape hatch: a line under a new `## Issue order` section in `plan.md` ("SAV-102's form doesn't use SAV-101's schema: <reason>"). The reason goes in the record. This reuses the existing DAG and phase checks in `plan-parse.ts`.

**b. Known when the plan starts, blocker outside the plan and not done.**
- Discover lists each one and asks: pull the blocker in / leave the blocked issue out (it goes to `## Issues not taken`) / go ahead anyway with a reason (stubbed or not really blocking).
- `cairn approve prd` refuses while an outside blocker has no recorded decision (a new `## Outside blockers` PRD section).
- If the blocker is already in another active plan, that is shown with its stage.

**c. Found during the build** (an implementer finds SAV-110 needs SAV-105's API).
- The existing blocked step runs: `cairn task step <id> blocked --note …`. Execute step 8 gets a new branch for dependencies.
- New command: `cairn linear depends SAV-110 --on SAV-105 --reason "…"`. It records the link in state and queues a `relation` write. In Linear that becomes `save_issue blockedBy`, which only adds links, plus a comment explaining it. The kinds of Linear write become `status`, `comment`, `relation`, `statusUpdate` and `createIssue`.
- If the blocker is in the plan: re-plan with `plan load --replan` to add the task dependency. The plan needs approval again, as it does today.
- If it is outside the plan and not done, ask the user:
  - pull it in, which amends the PRD and re-plans
  - drop the blocked issue from this plan; it is released in Linear and keeps its blocked-by link
  - stub the dependency, with a follow-up issue queued
  - pause

**d. Added in Linear by people while a plan is running.**
- The sync procedure (and `/cairn:board`) re-reads the plan's issues and pipes them to `cairn linear import --refresh`.
- The CLI compares the new links with the stored ones. A new link touching an in-plan issue is shown in `cairn status` and the pane. `phase finish` refuses until it has been handled the same way as in case c.
- A removed link is only noted.

**e. Across plans.** Plan B has an issue blocked by an issue in plan A.
- `cairn new --from-linear` warns when it starts.
- The board shows the chain.
- `cairn approve ship` on plan B refuses until A's issue has shipped, or the user records an override reason. This stops B merging code that relies on code A hasn't merged yet.

**Cycles.** Linear allows blocked-by cycles. Import and board detect them and show the loop. A plan can't load while its issues form a cycle; it refuses and asks for one link to be removed in Linear.

### 7. Project progress board
- Runs on main. `/cairn:board <project>` (a new thin skill) has the agent read the project's milestones and issues, including relations, and pipe them to `cairn linear import --board`. The CLI caches the snapshot outside git, at `<git common dir>/cairn/linear/<project>.json` (the same place `proof.ts` keeps the secret), so every worktree shares it.
- `cairn linear board` joins that snapshot with every plan's live state, read through the existing `status --all` path in `locate.ts`.
  - For each milestone it shows done / in a plan (which plan, which stage) / ready / blocked counts, plus stalled plans.
  - Inside each milestone, epics are grouped with "done / total" sub-issue counts and the plans that own parts of them. Issues with no parent are listed flat. `/cairn:board SAV-100` shows a single epic.
  - "Ready" means every blocker is done. A blocked issue shows what blocks it, including blockers in other milestones and plans.
  - Dependency cycles are flagged.
  - It shows how old the snapshot is.
- The mod gets a "Linear" pane tab that calls `cairn linear board --json` (the mod only reads, draws and calls the CLI). Declare its `$.state` keys in `types/index.d.ts`.

### Files to change (representative)
- CLI: new `cli/src/commands/linear.ts` and `cli/src/linear.ts` (import validation, outbox, `issueProgress`, board join). Then:
  - `types.ts` (state and config types)
  - `commands/stages.ts`, `commands/tasks.ts`, `commands/phase.ts`, `commands/merge.ts` (queue on transitions)
  - `render.ts` / `next` routing
  - `commands/hooks.ts` (pending count)
  - `main.ts` dispatch
- Docs and prompts:
  - procedures: `procedures/new.md`, `fix.md`, `discover.md`, `ship.md`, `learn.md`, and the new `linear-sync.md`
  - `templates/prd.md` (the `[KEY]` tag and `## Issues not taken`) and `templates/config.json`
  - `references/cli.md` (commands and refusals)
  - skills: new `skills/board/SKILL.md`, and an updated `skills/new`
  - `README.md` (a new Linear section)
  - a note in `docs/design.md` that this replaces item 13
- Mod: a pane tab in `hooks/mod/` (pattern of the existing Records/Changelog tabs).
- Version: bump `plugins/cairn/.claude-plugin/plugin.json` to the next minor, and rebuild `dist/cairn.mjs`.

## How to run it
This repo builds its own features with cairn, so this design is the starting input for a cairn plan, not a list of edits to make by hand. Run `/cairn:new` from main ("Linear integration", Standard level) and hand this file to discover. The plan will likely have four phases:
1. Config, import (including epic subtrees), issue tagging and progress.
2. Dependency and epic checks: plan-load ordering, outside blockers, the cycle check.
3. The write queue, the sync procedure, `linear depends` and refresh.
4. The board and pane tab.

## Verification
- CLI tests (node:test, throwaway git repos as in `lifecycle.test.ts`):
  - import validation (malformed JSON, unknown keys)
  - the PRD approval refusal for untagged issues
  - `issueProgress` across task states
  - the exact entries each transition queues
  - `sent` idempotency, and no duplicate `createIssue`
  - the board join across two plan branches
  - dependencies:
    - `plan load` refuses when a task for B doesn't come after a task for A, and accepts it with an `## Issue order` reason
    - phase ordering from dependency layers
    - `approve prd` refuses on an outside blocker with no decision
    - `linear depends` queues one `relation` entry, and repeating it is a no-op
    - `import --refresh` flags a new link and `phase finish` refuses until it's handled
    - `approve ship` refuses across plans
    - a cycle is refused
  - epics:
    - importing a parent brings its whole subtree, nested levels included
    - the tagging check skips a parent with no criteria of its own
    - a subset plan leaves the rest under `## Issues not taken`
    - a parent Done is queued only when the last sub-issue across plans ships, and skipped if Linear already closed it
    - a sub-issue added mid-plan is flagged on refresh
    - a blocked-by link on the parent applies to every sub-issue in the plan
  - with no `linear` config: no queued entries and unchanged output
- Doc tests: new procedure headings and phrases, the PRD template section, `cli.md` rows.
- Mod test: the Linear tab renders from a fake `cairn linear board --json` (in `hooks/test/world.tsx`).
- `npm run typecheck && npm test` and `claude plugin validate plugins/cairn`.
- End to end against the real SAV workspace:
  1. Create a test project with two milestones and five issues, with one blocked-by link. Add one epic: a parent with four sub-issues, one of them nested. Run one plan on the epic and confirm the parent closes when its last sub-issue ships.
  2. Start a plan from one milestone and walk it to ship. Mid-build, add a new blocked-by link in Linear and confirm the plan catches it. Record a found dependency with `linear depends` and confirm the link appears in Linear.
  3. Confirm in Linear the status moves, the comments, the PR link and the follow-up issue.
  4. Run `/cairn:board` and check the counts.
