# Hosts: Claude Code and Codex

cairn's procedures are written in Claude Code's terms. This page maps each of them to Codex. Match by capability: use the tool your session actually has, and never call a tool to find out whether it exists.

In Claude Code, nothing here changes anything: follow the procedures as written.

## How to tell which host you are on

- **Claude Code:** each skill's `Plugin root:` line shows a real path. Your tools include `AskUserQuestion` and `Agent`.
- **Codex:** that line still shows the `${…}` placeholder. Session start prints a `cairn CLI here: <path>` line. Your tools include `spawn_agent` and `request_user_input`.

## The cairn command

| | Claude Code | Codex |
|---|---|---|
| Where it is | `cairn` is on PATH | `<plugin root>/bin/cairn`, the path the session-start line prints. The plugin's `bin/` is not on PATH. A `cairn` found on PATH may be another host's older copy, so don't use it. |
| How to run it | `cairn <args>` | `"<plugin root>/bin/cairn" <args>`, with `cd <plan worktree> &&` in front, exactly where a procedure shows it |
| Plugin root | from `${CLAUDE_PLUGIN_ROOT}` | the folder two levels above the skill's `SKILL.md` |

## Asking the user

A procedure says "ask with AskUserQuestion", sometimes with a recommended option and a preview.

- **Claude Code:** use AskUserQuestion, with up to 4 options.
- **Codex:** use `request_user_input` when you have it. It takes 2 or 3 options. Keep the recommended option first. When a procedure lists 4 options, merge the two least likely into one, or leave one out and name it in the question text. Put a preview in the question text.
- **No question tool at all:** write the question and its options as plain text, then stop and wait for the answer.

## Approvals

Approvals of the PRD, the plan, a level change and the ship always come from the user, never from you.

- **Claude Code with the cairn mod running** (`modActive: true` in `cairn status --json`): the procedures' tagged questions (`[cairn:approve <kind> <slug>]`, `[cairn:level <slug>]`, `[cairn:override <slug>]`) work as written. The mod records the user's answer.
- **Codex, always.** Ignore `modActive` here: it can read true because a Claude Code session on the same repo is running the mod, but that mod never sees your questions. Take the branch the procedures give for `modActive: false`. The same applies in Claude Code when `modActive` is false.

  There is no menu approval. Give the user the full command, with real paths, to run in their own terminal:
  - approval: `cd <plan worktree> && "<plugin root>/bin/cairn" approve <prd|plan|ship> --human`
  - level change: `cd <plan worktree> && "<plugin root>/bin/cairn" level <mvp|standard|polished> --human`
  - override the user chose: the refused command with `--override "<their reason>" --human` added

  Wait for them to say it's done, then run `cairn status` to confirm.

Never type the approval yourself. That includes through a pseudo-terminal, `script`, `expect`, `tmux`, or by sending input to a running command. cairn's guard refuses those spellings in both hosts.

The guard is a best-effort check, not a security boundary. See "Trust model" in the README.

## Running agents

A procedure says "dispatch the `<role>` agent" with a `model`, sometimes an `effort`, a `description`, and a short prompt (usually a brief path).

- **Claude Code:** use the `Agent` tool with `subagent_type: cairn:<role>`, passing the model and effort as given.
- **Codex:** plugins can't bundle custom agents, so call `spawn_agent` like this:
  - Give it instructions with three parts, in order:
    1. the text of `<plugin root>/agents/<role>.md` after its frontmatter;
    2. a line naming the plugin root and saying that `cairn` means `<plugin root>/bin/cairn`;
    3. the procedure's prompt.
  - Pass `reasoning_effort` from the table below.
  - Pass `model` only when `.cairn/config.json` sets `codex.models.<tier>`; otherwise the agent uses the session's model.
  - Give the agent the same tool limits its frontmatter states. For example, a reviewer is read-only apart from its report file: tell it so in the instructions.

| cairn tier (and effort) | Codex `reasoning_effort` |
|---|---|
| haiku | low |
| sonnet | medium |
| sonnet, effort high | high |
| opus | high |
| opus, effort high | xhigh |
| any tier, effort low | low |

The frontmatter of reviewers, the recorder and the linear-sender carries an `effort:`. Apply it the same way.

- **Background runs:** "dispatch in the background and carry on" means: spawn the agent and keep working; collect its result when the procedure waits for it. If agents can only run one at a time on your host, run them one after another in the order the procedure lists. Tasks still use their own worktrees, and the merges still go one at a time.
- **Sending more work to a running agent** (Claude Code's SendMessage): spawn a fresh agent with the same role, worktree and model, and give it the new brief path. Briefs and reports are on disk, so nothing is lost.
- **Fresh eyes:** reviewers, checkers and the challenger must not see your conversation. Give them only the brief or report paths the procedure names, never a summary of what you think.

## What Codex does not have

- **The pane, menu approvals, and the mod's pause button.** `cairn status` shows the same state as text, and `/cairn:pause` and `/cairn:resume` work as skills.
- **The mod's `Read` and `Glob` guards.** The PreToolUse hook covers shell commands and `apply_patch` only.
- **Linear:** works when the Linear MCP server is connected in Codex. The `linear-sender` runs through `spawn_agent` like any other agent.
