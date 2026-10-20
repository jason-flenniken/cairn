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
- Read, Grep, and Glob may read plan state. No tool may read or write under `.git/cairn/`, which holds the secret's hash (`mod-secret.sha256`) and the heartbeat.
  - Grep and Glob may not search a `.git` folder at all.
  - Native builds don't register Grep or Glob, so those searches go through Bash.
- The Bash guard tokenizes the command the way a shell would: quotes, `;` `&&` `||` `|` `&`, subshells, `$(…)`, backticks, `sh -c`, and `eval`. It denies only these:
  - an `approve` argument to `cairn`, `…/bin/cairn`, or `node …/cairn.mjs`
  - setting `CAIRN_APPROVER`, by assignment or with `export`, `declare`, `read`, and the like
  - writes to a `state.json`: redirects, `sed -i`/`perl -pi`, `tee`, `cp`/`mv`/`rm`/`truncate`/`dd`/`ln`, `git checkout`/`restore`, or interpreter `-c`/`-e` code that names it
  - anything under `.git/cairn/`, except a read of `.git/cairn/mod-heartbeat` named exactly
  - a glob in or after a path component that could be `.git`, a recursive read of a `.git` folder, and `$(git rev-parse --git-common-dir)`-style paths
  - a pseudo-terminal wrapper around `cairn` (`script`, `expect`, `unbuffer`, `tmux`, `screen`, python/perl `pty`)

  Reading a plan's state, grepping for names like `CAIRN_APPROVER`, and git commands other than checkout/restore/rm/mv all run. The guard is a best-effort deny-list on spellings. The CLI's proof is the real control. `grep -r . .` from the repo root can still reach `.git`.

## Testing

`claude plugin test <dir>` runs every `*.test.ts` under `<dir>`, skipping only `node_modules` and dot-folders. That includes `cli/test`, whose node:test files can't load in the mod environment.

To avoid that, `npm run test:mod` copies `.claude-plugin/`, `hooks/`, and `types/` to a temp folder and runs `claude plugin test` there. Keep mod tests under `hooks/test/` and mod code under `hooks/` or `types/`.

## Live check

In a throwaway git repo, `claude -p --plugin-dir plugins/cairn --permission-mode bypassPermissions` produced these results:

| Call | Result |
| --- | --- |
| The model's `bin/cairn approve prd` | Denied with the FR-03 reason |
| `cat docs/sdlc/plans/x/state.json` | Ran |
| A Write to a new file in a new folder | Ran |
| A Write to `docs/sdlc/plans/x/state.json` | Denied |

The heartbeat file held the current epoch ms.
