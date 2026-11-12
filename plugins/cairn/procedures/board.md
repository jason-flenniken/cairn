# Board

Show how a Linear project is moving across plans: milestones, epics, what is done, in a plan, ready, or blocked. It works from main or from any plan worktree.

Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`. The Linear tools are named by base name (`list_milestones`, `list_issues`, `get_issue`); the prefix differs between installs.

## 1. Check
The argument is a project name, or an epic key such as `SAV-100` (then the project is the epic's own: read it with `get_issue`). Without one, ask which project with AskUserQuestion, offering the project in `.cairn/config.json`'s `linear` block first when there is one. Read `.cairn/config.json`: with no `linear` block, tell the user to add `"linear": { "team": "<team key>" }` and stop.

**Done when:** you have a project name or epic key and the repo has a `linear` block.

## 2. Read the project
Through the Linear MCP, read:
- the project's milestones (`list_milestones`);
- every issue in the project (`list_issues` with the `project` filter), following `cursor` while `hasNextPage` is true;
- for each issue, its blocked-by links (`get_issue` with `relations` in its `fields` list; `list_issues` returns none) and its parent.

Always read the whole project, even for an epic key: the snapshot is one per project, and a partial read would replace it.

Build one JSON object and pipe it to `cairn linear import --board`:

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

**Done when:** `cairn linear import --board` exited 0.

## 3. Show it
Run `cairn linear board --project "<project>"` (for an epic key, add `--epic <KEY>`, which shows only that epic) and show the user the result as printed: milestone counts, epics with their sub-issue counts, the plans that own them, what blocks what, any loop in the blocked-by links, and how old the snapshot is.

Add one line on what to do next when something stands out: stalled plans, ready issues, a loop to fix in Linear.

**Done when:** the board is shown.
