# Plan: Cleaner pane and records

> Source: prd.md. Each task is a thin, complete path through every layer, demoable on its own, and fits one context window.

## Goal
A pane with Now, History and Records tabs and steady, colored, clickable cards; follow-ups that stay few and come back only when relevant; records that write their own findings; and plan folders that sort by date.

## Architecture
The pane (`plugins/cairn/hooks/mod/pane.tsx`) keeps its poll and refresh code and gets a `tab` atom (contract in `plugins/cairn/types/index.d.ts`) driving a Button tab row; the Now view is rebuilt from fixed 3-line cards (each line a plain Button calling `viewPress`) and a stage color map next to `STAGE_LABEL`. Inline placement keeps its compact view with no tabs.

Plan folders: `locate.ts` gets `planDirName(slug, created)` for `cairn new` and a resolver that finds `<date>-<slug>` or legacy `<slug>` in a working tree (readdir) or a ref (`git ls-tree`); every `planRel` call site goes through it, and `status --json` rows carry the plan's `dir` so the mod stops building paths from the slug.

Follow-ups: status stays derived from append-only entries in `state.suggestions` (the `resolves` pattern). New entry kinds record a decline and a merge; `collectSuggestions` derives open / closed / merged / expired (declined twice, or older than 60 days). `cairn close` refuses more than 5 open follow-ups from the plan. Discovery uses the existing `suggest list --open --for`.

Records: `RECORD_SECTIONS` gains Findings; the recorder writes it from `state.log`; learn asks nothing. A `cairn records --json` command lists plans (date, title, stage, why line, record path, follow-ups) from the main checkout plus active plans, and the pane's Records tab reads it.

## Global constraints
- The running `cairn` and pane are main's copies until merge. Renaming this plan's own folder and trimming the old follow-ups happen with the new build at the end (see Deferred).
- Old branches (`sdlc/cairn-v0-2`, `sdlc/standard-branch-names`) keep the old folder name in their tree and must still resolve.
- `RECORD.md` word budget goes from 500 to 600 to make room for Findings.
- Each CLI task rebuilds `plugins/cairn/dist/cairn.mjs` with `npm run build` and commits it.

## Deferred requirements
- FR-13: the one-time grouping of the 17 open follow-ups runs in the learn stage, using this plan's new `suggest merge`, because main's `cairn` doesn't have it until merge.

## Phases

```yaml cairn-tasks
phases:
  - id: readable-now
    name: Readable Now tab and dated folders
    tasks:
      - id: dated-folders
        name: Dated plan folders
        covers: [FR-15, FR-16]
        blocked_by: []
        scope: ["plugins/cairn/cli/**", "plugins/cairn/dist/**", "plugins/cairn/hooks/mod/pause.ts", "plugins/cairn/hooks/test/pause.test.ts", "plugins/cairn/references/cli.md", "README.md", "docs/design.md"]
        complexity: standard
        risky: true
        riskReason: "moves tracked plan files; old folders and old branches must keep resolving"
      - id: pane-now
        name: Tabs and the Now view
        covers: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-19]
        blocked_by: []
        scope: ["plugins/cairn/hooks/mod/pane.tsx", "plugins/cairn/hooks/mod/activity.ts", "plugins/cairn/hooks/test/pane.test.tsx", "plugins/cairn/types/**"]
        complexity: standard
        risky: false
      - id: approval-hardening
        name: Approval hook fixes
        covers: [FR-17, FR-18]
        blocked_by: []
        scope: ["plugins/cairn/hooks/mod/approve.ts", "plugins/cairn/hooks/test/approve.test.ts"]
        complexity: simple
        risky: true
        riskReason: "the approval hook is the human-proof path"
  - id: few-follow-ups
    name: Few follow-ups and automatic findings
    tasks:
      - id: followup-rules
        name: Follow-up cap, merge, decline and expiry
        covers: [FR-10, FR-11, FR-12]
        blocked_by: [dated-folders]
        scope: ["plugins/cairn/cli/**", "plugins/cairn/dist/**", "plugins/cairn/procedures/discover.md", "plugins/cairn/procedures/plan.md", "plugins/cairn/procedures/ship.md", "plugins/cairn/procedures/suggestions.md", "plugins/cairn/references/**"]
        complexity: standard
        risky: false
      - id: findings
        name: Findings written automatically
        covers: [FR-14]
        blocked_by: [followup-rules]
        scope: ["plugins/cairn/cli/**", "plugins/cairn/dist/**", "plugins/cairn/procedures/learn.md", "plugins/cairn/templates/record.md", "plugins/cairn/agents/recorder.md"]
        complexity: simple
        risky: false
      - id: pane-history
        name: History tab
        covers: [FR-07]
        blocked_by: [pane-now]
        scope: ["plugins/cairn/hooks/mod/pane.tsx", "plugins/cairn/hooks/test/pane.test.tsx", "plugins/cairn/types/**"]
        complexity: simple
        risky: false
  - id: records
    name: Records tab
    tasks:
      - id: records-command
        name: List records from the CLI
        covers: [FR-08]
        blocked_by: [findings]
        scope: ["plugins/cairn/cli/**", "plugins/cairn/dist/**", "plugins/cairn/references/cli.md"]
        complexity: standard
        risky: false
      - id: pane-records
        name: Records tab in the pane
        covers: [FR-08, FR-09]
        blocked_by: [records-command, pane-history]
        scope: ["plugins/cairn/hooks/mod/pane.tsx", "plugins/cairn/hooks/test/pane.test.tsx", "plugins/cairn/types/**"]
        complexity: standard
        risky: false
```

### Task: dated-folders

**Check:** `cairn new demo` creates `docs/sdlc/plans/<today>-demo/`; with `cairn-v0-2` renamed to `2026-10-20-cairn-v0-2`, `cairn status --all` still lists both old plans, including the one read from an old branch.

**Interfaces**
- Consumes: none
- Produces: `planDirName(slug, created)`, `resolvePlanDir(slug, {root} | {ref})` in `locate.ts`; `dir` (absolute plan folder) on every `status --json` row; `pause.ts` handoff path from `dir`. Docs say `docs/sdlc/plans/<date>-<slug>/`.

**Test cases**
- Happy: `cairn new demo` on 2026-10-21 creates `docs/sdlc/plans/2026-10-21-demo/state.json` and the branch is `feature/demo`.
- Happy: a plan whose folder is renamed from `shop` to `2026-10-01-shop` on its branch is still found by `status`, `next` and `task start`.
- Unhappy: a branch whose tree still has `docs/sdlc/plans/shop/` resolves to that folder; a checkout holding both `shop/` and `2026-10-01-shop/` lists the plan once.
- Security: a slug that would match another plan's suffix (`shop` vs `2026-10-01-pet-shop`) resolves only an exact `<date>-shop` or `shop`.

### Task: pane-now

**Check:** with two agents working, the pane shows Now / History / Records, then the header and bar in the stage color, Main session first, and each agent card is 3 lines whether or not a tool is running; pressing any card line switches the view to that agent.

**Interfaces**
- Consumes: none
- Produces: `tab` atom (`'now' | 'history' | 'records'`) in the contract; `STAGE_COLOR` next to `STAGE_LABEL`; History and Records tabs render a placeholder line until their tasks land. No follow-up count anywhere; status text reads `ready` only.

### Task: approval-hardening

**Check:** on a stop tagged twice, Revise then Approve records the approval; a question payload that is not a list passes through untouched.

**Interfaces**
- Consumes: none
- Produces: `judged` filled only after an approval attempt; `parseTags` callers guard with `Array.isArray(e.questions)`.

**Test cases**
- Happy: two questions tagged `[cairn:approve prd shop]`, answered Revise then Approve, record one approval.
- Unhappy: `e.questions` is an object or missing; the hook calls `next(e)` and records nothing.
- Security: Revise then a typed "yes" on a clicked-option question still does not approve (the existing `isApproval` rule holds).

### Task: followup-rules

**Check:** `cairn close` refuses a plan with 6 open follow-ups and names them; after `cairn suggest merge` groups 3 into one, it passes; a follow-up declined twice or 61 days old is listed as expired.

**Interfaces**
- Consumes: `resolvePlanDir` from dated-folders
- Produces: `cairn suggest merge <key...> --area --where --text`, `cairn suggest decline <key...>`, derived status `open | closed | merged | expired` in `suggest list --json`; close refuses more than 5 open from the plan. Procedures: discover offers matching follow-ups in one multi-pick question (picked: resolve with "brought into <plan>"; others: decline); plan.md drops its past-suggestions step; ship and suggestions procedures use the new statuses.

### Task: findings

**Check:** `cairn close` refuses a record with no Findings section; the learn procedure has no question and tells the recorder to write Findings from the plan log and group follow-ups to 5 before closing.

**Interfaces**
- Consumes: `suggest merge` from followup-rules
- Produces: `RECORD_SECTIONS` with Findings, budget 600; record template and recorder agent with Findings; learn.md: group follow-ups, write findings, close, no stop.

### Task: pane-history

**Check:** the History tab shows every plan log entry and agent finish for the current plan, newest first, in stage colors.

**Interfaces**
- Consumes: `tab` atom and `STAGE_COLOR` from pane-now
- Produces: History view; `recentLines` without the 5-line cap.

### Task: records-command

**Check:** `cairn records --json` in a repo with two closed plans and one active lists all three, newest first, each with date, title, stage, why line, record path and its follow-ups.

**Interfaces**
- Consumes: `resolvePlanDir`, `collectSuggestions` statuses
- Produces: `cairn records --json` → `{records: [{slug, title, date, stage, why, record?, followUps: [{text, area, status}]}]}`, reading folders in the main checkout plus active plan rows.

### Task: pane-records

**Check:** the Records tab lists the plans from `cairn records --json`; pressing one shows its record and follow-ups as Markdown with a Back button that returns to the list.

**Interfaces**
- Consumes: `cairn records --json`; `dir` on status rows (the pane's watched `state.json` path uses it)
- Produces: Records list and record view; empty and missing-record messages from the PRD's unhappy paths.
