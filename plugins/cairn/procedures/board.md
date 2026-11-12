# Board

Show how a Linear project is moving across plans: milestones, epics, what is done, in a plan, ready, or blocked. It works from main or from any plan worktree.

Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`. The Linear tools are named by base name (`list_milestones`, `list_issues`, `get_issue`); the prefix differs between installs.

## 1. Check
The argument is a project name, or an epic key such as `SAV-100` (then the project is the epic's own: read it with `get_issue`). Without one, ask which project with AskUserQuestion, offering the project in `.cairn/config.json`'s `linear` block first when there is one. Read `.cairn/config.json`: with no `linear` block, tell the user to add `"linear": { "team": "<team key>" }` and stop.

**Done when:** you have a project name or epic key and the repo has a `linear` block.

## 2. Read the project
Read only what changed, then fill in the links for those issues. Through the Linear MCP:
1. Read the project's milestones (`list_milestones`), then every issue in the project: `list_issues` with the `project` filter and `fields` including `updatedAt`, `statusType`, `projectMilestone` and `parentId` (it returns no relations), following `cursor` while `hasNextPage` is true.
2. Build the JSON below from that listing and pipe it to `cairn linear import --board --merge`. It folds the listing into the stored snapshot: an issue sent without `blockedBy` or `parent` keeps the stored ones, and issues missing from the listing are dropped (the listing is the whole project, even for an epic key). The output's `data.needRelations` lists the open issues that are new, changed since the last read, or never had their links read.
3. For only those keys, call `get_issue` with `relations` in its `fields` list. Never fetch completed, canceled or duplicate issues. Give each such issue its `blockedBy` (`[]` when nothing blocks it) and `parent` (`null` when it has none), and pipe just those issues to `cairn linear import --board --links`. It applies them on top of the stored snapshot (fields left out keep their stored values) and refuses when no snapshot exists yet. Never use `--merge` for this step: it treats its input as the whole project and would drop every issue not listed.

The first read of a project (no snapshot yet) lists every open issue in `needRelations`, so steps 1 to 3 read all the links and count as a full read. With `--full` in the arguments, read every open issue's relations instead and pipe the whole project to `cairn linear import --board` with neither flag: that replaces the snapshot and records a full read. Do not decide on a full read yourself; the board in step 3 says when one is due, and the user asks for it.

The JSON for both imports:

```json
{
  "project": "Checkout rewrite",
  "milestones": ["M1 Payments", "M2 Refunds"],
  "issues": [
    { "key": "SAV-101", "title": "Card form", "url": "https://linear.app/…", "stateType": "started", "stateName": "In Progress",
      "milestone": "M1 Payments", "parent": "SAV-100", "blockedBy": ["SAV-099"] }
  ]
}
```

`stateType` is Linear's status type (`backlog`, `unstarted`, `started`, `completed`, `canceled`). A blocker outside the project may be given as an object (`{ "key", "title", "stateType" }`). Map Linear's fields to these names exactly as `procedures/new.md` step 2a describes (`statusType`, `projectMilestone` and `parentId` become `stateType`, `milestone` and `parent`, with the parent written as its `SAV-n` identifier).

**Done when:** every `cairn linear import --board` call exited 0 and `needRelations` was fetched and imported (or `--full` was run).

## 3. Show it
Run `cairn linear board --project "<project>"` (for an epic key, add `--epic <KEY>`, which shows only that epic) and show the user the result as printed: the milestones, what is in progress, ready to start, waiting and done, later milestones, any loop in the blocked-by links, and how old the snapshot is. Under "Ready to start:" each epic whose open sub-issues are all ready carries `(/cairn:new --from-linear <KEY>)`; point the user to it. When the board says the project has had no full read yet, or the last one is over 3 days old, pass on its hint to run `/cairn:board <project> --full`.

When the board reports wide links (an epic's blocked-by link that makes all of its open issues wait), say so in plain words and offer once with AskUserQuestion: "N epic links hold back work. Narrow them?"
- Narrow them (Recommended): follow `procedures/relink.md` for each wide link, one at a time, the one holding the most issues first.
- Not now: carry on.

Add one line on what to do next when something stands out: stalled plans, ready issues, a loop to fix in Linear.

**Done when:** the board is shown.
