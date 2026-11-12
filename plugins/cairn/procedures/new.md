# New plan

Start a feature plan: title, slug, repo config, branch and worktree. Then continue into discover.

Templates live in `templates/`, next to this `procedures/` folder (`${CLAUDE_PLUGIN_ROOT}/templates/<file>`). Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn status --json`.
- On a plan branch (one that holds `docs/cairn/plans/<date>-<slug>/state.json`, such as `feature/<slug>`, `fix/<slug>`, or `task/<slug>/<task>`), tell the user a plan is already active, name it, and stop. Offer `/cairn:next` to continue it.
- On any other branch, continue.

**Done when:** you know the session is on a non-plan branch (main or similar).

## 2. Title and slug
When the arguments hold `--from-linear <selection>`, do step 2a first and take the title and slug from it.

Otherwise ask with AskUserQuestion: "What are we building?" Offer 2-3 short title options derived from the user's request (the first marked "(Recommended)"), each with a kebab-case slug in its description. The user can type their own through "Other".

**Done when:** you have a title and a kebab-case slug of at most 40 characters.

## 2a. Linear selection (only with `--from-linear`)
The selection is one of `SAV-100`, `SAV-101,SAV-102`, `milestone:"<name>"`, or `project:"<name>"`. `.cairn/config.json` needs a `linear` block (`{ "team": "SAV" }`; `statuses` is optional). When it has none, read it in step 3 and add the block there before importing.

Fetch the selection through the Linear MCP (tools by base name; the prefix differs between installs):
- Issues by key: `get_issue`, with `relations` in its `fields` list (a `fields` list overrides `includeRelations`), which gives the blocked-by links.
- A milestone or a project: `list_issues` with the `project` filter, following `cursor` while `hasNextPage` is true. `list_issues` returns no relations, so then call `get_issue` (with `relations` in `fields`) for each issue kept, for its blocked-by links. There is no milestone filter, so keep the issues whose `projectMilestone` is the named one. Read the milestone list with `list_milestones` when the name is not exact.
- An issue with sub-issues is an epic and brings its whole subtree: read its children with `list_issues` and `parentId`, then theirs, level by level. A milestone that contains such a parent brings the parent's sub-issues too. A single sub-issue does not bring its parent or siblings, but its parent goes in `epic`.

Build one JSON object:

```json
{
  "project": "Checkout rewrite",
  "milestone": "M1 Payments",
  "epic": "SAV-100",
  "selection": "SAV-100",
  "issues": [
    { "key": "SAV-100", "title": "Checkout", "url": "https://linear.app/…", "stateType": "unstarted", "milestone": "M1 Payments" },
    { "key": "SAV-101", "title": "Card form", "url": "https://linear.app/…", "stateType": "unstarted", "milestone": "M1 Payments",
      "parent": "SAV-100", "blockedBy": ["SAV-099"] }
  ],
  "known": [
    { "key": "SAV-099", "title": "Payment schema", "stateType": "started" }
  ]
}
```

- `issues` are the ones this plan may build. `known` are issues outside the plan that matter: blockers of an in-plan issue, and the epic's other sub-issues, each with `stateType` (`backlog`, `unstarted`, `started`, `completed`, `canceled`) so cairn knows which are done. A blocker given as an object inside `blockedBy` is also treated as known.
- `team`, `project`, `milestone`, `epic` and `selection` are optional. Unknown fields are refused.
- Linear's field names differ from the import's. Ask `list_issues` for `fields: ["id", "title", "url", "status", "statusType", "projectMilestone", "parentId", "description", "labels"]` and `get_issue` for the same list plus `"relations"`, then map each issue: `key` is the issue identifier (`SAV-101`); `title` and `url` as given; `stateType` is `statusType`; `stateName` is `status`; `milestone` is the name of `projectMilestone`; `parent` is `parentId` written as the parent's identifier; `description` goes in as given (`null` when the ticket has none); `labels` is the list of label names. When `parentId` comes back as an internal id rather than `SAV-n`, find that parent in the same results (or with `get_issue`) and use its identifier. `blockedBy` lists the identifiers from the "blocked by" relations `get_issue` returns with `includeRelations: true`. For every issue you read in full, always give `parent` (`null` when it has none) and `blockedBy` (`[]` when nothing blocks it): on a refresh, a missing field means "not read" and keeps the old value, while `null` or `[]` means the link is gone. Leave out every other field: the import refuses fields it does not know.

Name the plan. When the selection is exactly one issue, put its key in the slug so the branch carries it (`feature/sav-101-card-form`); the slug stays kebab-case and at most 40 characters. Otherwise derive the title from the epic, milestone or project. Confirm the title and slug with AskUserQuestion as in step 2, the first option marked "(Recommended)".

**Done when:** you hold the import JSON, a title and a slug.

## 3. Repo config
Check for `.cairn/config.json`, then for the legacy `.sdlc/config.json`.
- Either present: read it and move on; never write a second config. When only `.sdlc/config.json` exists, say once that `cairn migrate` (on main, with no plan in flight) moves the repo to `.cairn/` and `docs/cairn/`.
- Neither present: detect commands from `package.json` scripts, `Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `app.json` (Expo), and similar. Fill the shape of `${CLAUDE_PLUGIN_ROOT}/templates/config.json` (`test`, `build`, `start`, `seed`, `appTypes`, `maxParallel`, `autoCommit`). Ask with AskUserQuestion, one question per uncertain field (test command first), recommended detection first, with the proposed JSON as a preview. Write `.cairn/config.json`, then commit it on the current branch: `git add .cairn/config.json && git commit -m "chore: add cairn config"`.

**Done when:** `.cairn/config.json` (or the legacy `.sdlc/config.json`) exists and is committed, and its `test` command is non-empty.

## 4. Level
Ask once with AskUserQuestion, a plain choice and not an approval: "How much effort should this build spend?" Options, with the repo's default first and marked "(Recommended)" (`defaultLevel` in `.cairn/config.json`, Standard when unset):
- MVP: a short interview, few large tasks, no per-task review, red tests warn; shortcuts go on a hardening list for later.
- Standard: the full interview, every task reviewed, tests, scans and the full branch review.
- Polished: Standard plus test-first on every task, a fresh read of the plan, and the on-track check after every phase.

`references/levels.md` has the full table. When the issues fetched in step 2a include one carrying the foundational label (`linear.foundationalLabel` in `.cairn/config.json`, default `foundational`, any case), list Polished first, marked "(Recommended)", with a one-line reason: the ticket is flagged foundational, so the approach deserves the extra rigor. The user still picks; never change the level yourself.

Security review of risky work and the three approvals stay at every level. This answer is applied as given; changing the level later needs the user's own proof. A fix plan (`--track fix`) has no level: skip this step for it.

**Done when:** you hold the level the user picked.

## 5. Create the plan
With `--from-linear`, first check whether the work can start alongside another plan. Run `cairn linear board --json` (skip this when it refuses because no project has been read). Look in `data.alongside` for the selection: the epic key, or each selected issue key. When every one of them is listed and all name the same plan in `after` (`after[].slug`), the outside blockers are built (the plan is in verify or later, or every task is done) and in review or built in that one plan, so the new plan can start on that plan's branch instead of waiting. Ask with AskUserQuestion, the first option marked "(Recommended)":
- Start on `<after branch>` (Recommended): the new plan begins with that plan's code, and moves onto main once that plan has merged. It cannot ship before then.
- Wait for it to merge: start from main as usual.
When the work does not fit one plan (its blockers sit in several plans), or the user waits, start from main.

Run `cairn new <slug> --title "<title>" --level <mvp|standard|polished>`, adding `--after <plan slug>` when the user chose to start on that plan's branch. `--after` refuses unless that plan is built (verify or later, or every task done) and not closed, and with `--track fix`; pass on its message when it refuses. The output prints the plan worktree path.

**Done when:** the command exits 0 and you have the worktree path.

## 5a. Pull the issues in (only with `--from-linear`)
Pipe the JSON from step 2a into the new plan: `cd <plan worktree> && cairn linear import` (or save it to a file and pass `--file <path>`). Report its message in your own words, in a few lines: how many issues came in, the epic and its sub-issue count, blockers outside the plan, issues already in another active plan, and a loop in the blocked-by links when there is one. When there are more than about 8 leaf issues, say that discover will offer a subset. A refusal names the fix (a bad key, an unknown field): correct the JSON and run it again.

**Done when:** `cairn linear import` exited 0.

## 6. Tell the user where the plan lives
Tell the user the plan worktree path and the level in one line. Never move the session into the worktree with a worktree-entering tool: a session locked to a worktree blocks its subagents from editing and committing in task worktrees. You stay at the repo root, and every later `cairn` command runs as `cd <plan worktree> && cairn <command>`.

Confirm with `cd <plan worktree> && cairn status --json` that the stage is `discover`.

**Done when:** the user has the worktree path and the stage is `discover`.

## 7. Continue
Tell the user in one line that the plan exists and discovery starts. Run `cd <plan worktree> && cairn next --json` and follow the procedure it names (discover).

**Done when:** the discover procedure is running.
