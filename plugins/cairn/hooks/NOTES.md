# cairn mod notes

## API check (headless `claude -p --plugin-dir` probe, Claude Code 2.1.30x)

1. **`tool.call` fires for a subagent's Bash call.** The event carries `agentId`, and a `{ deny }` returned there holds: the subagent's Bash call is refused. So the FR-03 Bash guard covers subagents as well as the main loop.
2. **`$.command.run({ command: 'cairn:status' })` runs the plugin's skill command.** Resume can use it. It doesn't need the `$.prompt.submit` fallback.

## Heartbeat format (FR-06)

`<git common dir>/cairn/mod-heartbeat` holds one value: epoch milliseconds as plain decimal text, with no newline (for example `1792532987012`). The mod writes it at `session.start` and every 2 s after that. It finds the common dir with `git rev-parse --path-format=absolute --git-common-dir`. Outside a git repo the heartbeat is skipped. An unwritable folder skips that beat. The CLI treats the mod as active while the value is under 10 s old.

A hot reload drops the old timer. `session.start` fires again for a changed module, so the beat restarts.

## Guards (FR-03, FR-04, NFR-02)

- Both guards are `tool.call` hooks with a fail-closed `.catch`.
  - The Bash guard is matched on `{ tool: 'Bash' }`.
  - The path guard sees every call but only judges a non-Bash call with `file_path`, `path`, or `notebook_path`. Its `.catch` denies only such a call. Every other call goes on, so a mod failure never blocks unrelated tools (NFR-07).
- Before `fs.stat` sees a path, the engine has already made it absolute against the session folder and folded `..` lexically.
- A missing path rejects with `ENOENT`. For a missing path, the guard resolves the deepest existing ancestor and appends the rest, because a Write creates folders. Any other stat error propagates, and the `.catch` denies.
- A path starting with `~` is denied, because the guard can't tell where the tool would land it.
- Heredoc and here-string bodies fed to `python`, `node`, `ruby`, `perl` and similar are code, not shell, so they are not scanned. Bodies fed to `sh`/`bash`/`zsh`, or anything else, are scanned as shell. Text piped into a bare shell (`echo … | bash`, `cat <<EOF | sh`) is scanned.
- Arguments to `cairn decide` and `--note`/`--why` values are prose: an approve word there is not an approval. Only single-quoted prose skips substitution scanning. In double-quoted or bare prose, backticks and `$(…)` are scanned the way a shell would run them. Markdown-heavy text goes in single quotes or a file (`--file`/`--note-file`).
- Read, Grep, and Glob may read plan state. No tool may read or write under `.git/cairn/`, which holds the secret's hash (`mod-secret.sha256`) and the heartbeat.
  - Grep and Glob may not search a `.git` folder at all.
  - Native builds don't register Grep or Glob, so those searches go through Bash.
- The Bash guard tokenizes the command the way a shell would: quotes, `;` `&&` `||` `|` `&`, subshells, `$(…)`, backticks, `sh -c`, and `eval`. It denies only these:
  - an `approve` argument to `cairn`, `…/bin/cairn`, or `node …/cairn.mjs`
  - setting `CAIRN_APPROVER`, by assignment or with `export`, `declare`, `read`, and the like
  - writes to a `state.json`: redirects, `sed -i`/`perl -pi`, `tee`, `cp`/`mv`/`rm`/`truncate`/`dd`/`ln`, `git checkout`/`restore`, or interpreter code (`-c`/`-e`, or a heredoc or here-string body) that names it and could write it (`open(…,'w'/'a'/'r+')`, `write_text`, `json.dump`, `writeFileSync`, `fs.write`, a shell-out). Interpreter code that only reads one runs.
  - anything under `.git/cairn/`, except a read of `.git/cairn/mod-heartbeat` named exactly
  - a glob in or after a path component that could be `.git`, a recursive read of a `.git` folder, and `$(git rev-parse --git-common-dir)`-style paths
  - a pseudo-terminal wrapper around `cairn` (`script`, `expect`, `unbuffer`, `tmux`, `screen`, python/perl `pty`)

  Reading a plan's state, grepping for names like `CAIRN_APPROVER`, and git commands other than checkout/restore/rm/mv all run. The guard is a best-effort deny-list on spellings. The CLI's proof is the real control. `grep -r . .` from the repo root can still reach `.git`.

## Menu approval and overrides (FR-02, FR-34)

- The secret lives only in `mod/approve.ts`'s memory. `<git common dir>/cairn/mod-secret.sha256` holds its SHA-256 as lowercase hex, written with `$.fs.write` and then `chmod 600`, because `$.fs.write` takes no mode.
- The hash file doesn't exist until the first approval or override. The mod writes the secret and its hash just before first use, and writes a fresh pair after every use, whatever the CLI answered. Uses run one at a time, so two approvals that land together each get their own secret.
- The engine allows one matcherless hook per event per module. `register.tsx` owns the single `session.start` hook and calls each module's start work in turn (heartbeat, pause, pane). A failing module never stops the others or the session, so approve.ts, pause.ts, and pane.tsx have no `session.start` hook of their own.
- Approval kinds are `prd`, `plan` and `ship`; a phase needs no human. An answer approves when it is a label starting "Approve", or free text opening with approve, approved, lgtm or yes.
- The approval hook reads only `result.answers` from the dialog. It ignores answers the model put in its own call's input, which it copies before the dialog runs, a result with `afkTimeoutMs`, a dismissed or failed dialog, and subagents' dialogs. It has no `.catch`: if it throws, the hook is skipped and the user's answer goes on unchanged.
- Every `process.run` the mod makes has a timeout: 60 s for `status` and `chmod`, 10 minutes for `approve` and an override. A hung CLI then can't hold up later uses of the secret, and its failure is reported.
- An "Override" answer is held in memory for 10 minutes. The Bash hook runs the model's plain `cairn … --override "…"` itself and returns the CLI's output as the tool's result. It runs the command for the plan whose worktree the session is in, or for the one plan holding an override. Commands run as written, with a context line saying why the override wasn't used, when they contain any of these:
  - `; | & $ \` > <`, a newline, or a backslash, outside quotes
  - an unquoted `# * ? ~ ( ) { } [ ]`

  Inside single or double quotes any character is allowed, because the mod runs the words as argv through `$.process.run`, never a shell.

  That includes `cd <wt> && cairn …`. A command that includes `approve` is never run this way.
- A hook can't mark a Bash result as an error. Core ignores `isError` on a hook's Bash result, and a string result fails Bash's output schema (checked in a `-p` probe). So a failed override's stdout starts with `Exit code N`, the way the Bash tool's own does, and its context line names the exit code. The probe also showed that a hook's `{ stdout, stderr, interrupted }` result and its `context` reach the model.

## Mod commands, pause, and Stop now

- Mod command names have no ":" because the engine forbids it: `cairn-pane`, `cairn-approve`, `cairn-pause-now`, `cairn-pause-mod`, `cairn-resume-mod`.
- A plugin's own `$.command.run` skips its own hooks. The mod can't run its own commands through it.
- Stop now cuts the running turn, and the engine refuses a `prompt.submit` made from the command's own hook (it would wait on the turn the hook holds). The mod remembers the id of the cut turn and sends the message to the model when that turn completes. The message tells it to stop its subagents, record each task's substep, commit work in progress, and finish with `cairn pause --now`.
- Pause (`cairn-pause-mod`) waits for in-flight work to reach a safe point instead of cutting the turn.

## Agent cards (pane)

- `agent.spawn`'s `next(e)` resolves with the new `agentId`; that same id is on the agent's `tool.call`, `turn.start` and `turn.complete` events (each run of an agent's loop is one turn, so a woken agent fires `turn.start` again) and in `$.agent.list()`. `activity.ts` keys its cards on it. The probe was the type docs only; a live background-agent run is still to check.
- Activity rides the existing unmatched hooks (one per event per module): `tool.call` in `guards.ts` after the guards allow, `turn.start`/`turn.complete` in `pause.ts`. `register.tsx` adds the `session.start` rebuild from `$.agent.list()`.
- The engine follows `$` into another file only through a `function` declaration, not a `const` arrow, so every helper there that takes `$` is one, and `import * as ns` calls are refused.
- Token counts arrive only at `turn.complete`, so a card shows tokens when it finishes, not live. The pane opens with `columns: 48, rows: 7`; `session.start` has no fullscreen flag, so the open is unasked and the engine seats it only on a wide fullscreen terminal.

## Pinned bar (pane)

- The pane's code is split by concern: `pane.tsx` (registration, tabs, routing, Records, `frame`), `header.tsx` (plan header, status line), `cards.tsx` (agent and main-session cards), `approval.tsx` (approval card), `bar.tsx` (bottom bar).
- The engine owns the docked body's window (`e.props.scroll = { offset, bodyRows }`). The bar is a `position: 'absolute'` Box at `top = offset + bodyRows - barRows`, as the last child of the tab's root.
  - The root gets `paddingBottom` of the bar's rows plus one blank row, so the last content row clears the bar at the end of the scroll.
  - The root also gets `minHeight = bodyRows`, so on a short tab the bar still sits at the bottom.
  - Each bar line is padded with spaces to the bar's width, so it covers the content scrolled beneath it.
- Why absolute and not our own window:
  - Own rows would fix the root at `bodyRows` and shift the content by an offset of the mod's. Then the tree always fits, so `ui.scroll`'s `contentRows` equals `bodyRows` and the mod can't clamp its offset without measuring its content. It would also lose the engine keeping a Tab-focused button in view.
  - Absolute keeps the engine's scrolling. Its cost: on the terminal the engine's own moves (following the end, a clamp, a held element kept in view) don't re-ask the render, so the bar can sit off the bottom until the next redraw. The 1 s tick and the 2 s poll redraw while anything runs.
- A `ui.scroll` hook on the pane calls `next(e)` and then `$.ui.invalidate('ui.render')`, so the bar follows every move.
- The test kit runs the `ui.scroll` chain but never changes the mounted `props.scroll`; a test redraws with the new offset itself.
- Inline (the 7-row pane) has no pinning: the bar is one line at the end, the active step. The "run /tui fullscreen" tip shows only while it still fits the 7 rows (it goes for a fallback plan with an approval waiting).
- Bar lines wrap between steps to fit `bodyColumns - 2` cells (46 docked), counting an emoji as 2 cells (NFR-01).

## Testing

`claude plugin test <dir>` runs every `*.test.ts` under `<dir>`, skipping only `node_modules` and dot-folders. That includes `cli/test`, whose node:test files can't load in the mod environment.

To avoid that, `npm run test:mod` copies `.claude-plugin/`, `hooks/`, and `types/` to a temp folder and runs `claude plugin test` there. Keep mod tests under `hooks/test/` and mod code under `hooks/` or `types/`.

Pane tests share one world beneath the mod, `hooks/test/world.tsx`: the CLI, git, the files, the dialogs, the row builders and the mount helpers. Each pane feature gets its own test file.

## Live check

In a throwaway git repo, `claude -p --plugin-dir plugins/cairn --permission-mode bypassPermissions` produced these results:

| Call | Result |
| --- | --- |
| The model's `bin/cairn approve prd` | Denied with the FR-03 reason |
| `cat docs/sdlc/plans/x/state.json` | Ran |
| A Write to a new file in a new folder | Ran |
| A Write to `docs/sdlc/plans/x/state.json` | Denied |

The heartbeat file held the current epoch ms.
