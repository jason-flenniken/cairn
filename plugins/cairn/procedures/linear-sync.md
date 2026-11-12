# Linear sync

Send the updates cairn has queued for Linear, mark each one sent, then carry on with the stage. Linear owns the backlog; cairn only queues what is due and you send it through the Linear MCP.

Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`. Run every `cairn` command from the plan worktree: `cd <plan worktree> && cairn <command>`.

The Linear tools are named here by their base name (`save_issue`, `save_comment`, `save_status_update`, `create_issue_label`, `list_issue_labels`). The prefix differs between installs: use the Linear tools you have. When no Linear tools are available, say so in one line, put every entry on hold (`cd <plan worktree> && cairn linear hold <id> --note "no Linear tools"`), and go to step 5. A held entry stays queued and is tried again at the next sync, but `cairn next` no longer sends you here for it alone.

## 1. List what is waiting
Run `cd <plan worktree> && cairn linear pending --json`. Each entry in `pending` has `id`, `kind`, `target`, `tool`, `payload`, `why`, and `needsApproval` when the user has to see it first.

**Done when:** you hold the list of unsent entries.

## 2. Prepare
Follow-ups are filed per `linear.fileFollowUps`: by default only ordinary ones, and hardening items stay in cairn. Before the first `createIssue` entry, make sure the `cairn-follow-up` label exists: look for it with `list_issue_labels` for the team, and create it with `create_issue_label` when it is missing. Skip this when no entry creates an issue.

**Done when:** the label exists, or no entry needs it.

## 3. Send
Send the entries that need no approval, one at a time, in the order listed. For each, call the tool its `tool` field names with `payload` as given, unchanged:
- `status` and `relation`: `save_issue`. The payload already holds `id` and `state` (or `blockedBy`, which only adds links).
- `comment`: `save_comment` with `issueId` and `body`.
- `createIssue`: `save_issue` with `team`, `title`, `description`, `labels`, and the project and milestone when present.

Put any agent-specific detail you add to a description or comment (file lists, task ids, logs) in a collapsed block at the end: a line `+++ Agent notes`, the detail, then a line `+++`. The text a person reads stays short.

After each send that worked, run `cd <plan worktree> && cairn linear sent <id>`. For `createIssue`, add `--ref <the new issue key>` (for example `--ref SAV-131`): cairn remembers the key so the follow-up is never filed twice.

A send that fails stays queued: run `cd <plan worktree> && cairn linear hold <id> --note "<the error>"`, note it in one line, and go on to the next entry. A failure never blocks the stage. Entries listed as held were tried before: send them like the rest.

**Done when:** every entry that needs no approval was sent and marked, or failed and noted.

## 4. Ask about the entries that need approval
Entries with `needsApproval` (the project status update) are the user's words going out under their name. For each, show its `payload.body` and `payload.health`, then ask with AskUserQuestion:
- Send (Recommended): call `save_status_update` with the payload, then `cairn linear sent <id>`.
- Edit: ask what to change, apply it to the body, and ask again.
- Don't send: run `cd <plan worktree> && cairn linear drop <id> --note "<why>"`.

**Done when:** each such entry was sent, dropped with a note, or held (`cairn linear hold <id> --note "the user wants to wait"`) when the user said to wait.

## 5. Report and continue
Say what went out in one or two lines ("Sent 4 updates to Linear: 2 statuses, 2 comments"), plus any that failed or are held. Then run `cd <plan worktree> && cairn next --json` and follow the procedure it names.

**Done when:** the next procedure started.
