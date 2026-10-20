# cairn mod notes

## API check (headless `claude -p --plugin-dir` probe, Claude Code 2.1.30x)

1. **`tool.call` fires for a subagent's Bash call.** The event carries `agentId`, and a `{ deny }` returned there holds: the subagent's Bash call is refused. So the FR-03 Bash guard covers subagents as well as the main loop.
2. **`$.command.run({ command: 'cairn:status' })` runs the plugin's skill command.** Resume can use it. It doesn't need the `$.prompt.submit` fallback.

## Heartbeat format (FR-06)

`<git common dir>/cairn/mod-heartbeat` holds one value: epoch milliseconds as plain decimal text, with no newline (for example `1792532987012`). The mod writes it at `session.start` and every 2 s after that. It finds the common dir with `git rev-parse --path-format=absolute --git-common-dir`. Outside a git repo the heartbeat is skipped. An unwritable folder skips that beat. The CLI treats the mod as active while the value is under 10 s old.

## Guards (FR-03, FR-04, NFR-02)

- Both guards are `tool.call` hooks with a fail-closed `.catch`.
  - The Bash guard is matched on `{ tool: 'Bash' }`.
  - The path guard sees every call but only judges a non-Bash call with `file_path`, `path`, or `notebook_path`. Its `.catch` denies only such a call. Every other call goes on, so a mod failure never blocks unrelated tools (NFR-07).
- Before `fs.stat` sees a path, the engine has already made it absolute against the session folder and folded `..` lexically.
- A missing path rejects with `ENOENT`. For a missing path, the guard resolves the deepest existing ancestor and appends the rest, because a Write creates folders. Any other stat error propagates, and the `.catch` denies.
- A path starting with `~` is denied, because the guard can't tell where the tool would land it.
- Read, Grep, and Glob may read plan state. No tool may read under `.git/cairn/`, which holds the secret.

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
