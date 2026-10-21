# New plan

Start a feature plan: title, slug, repo config, branch and worktree. Then continue into discover.

Templates live in `templates/`, next to this `procedures/` folder (`${CLAUDE_PLUGIN_ROOT}/templates/<file>`). Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn status --json`.
- On a plan branch (`sdlc/<slug>` or `sdlc-task/...`), tell the user a plan is already active, name it, and stop. Offer `/cairn:next` to continue it.
- On any other branch, continue.

**Done when:** you know the session is on a non-plan branch (main or similar).

## 2. Title and slug
Ask with AskUserQuestion: "What are we building?" Offer 2-3 short title options derived from the user's request (the first marked "(Recommended)"), each with a kebab-case slug in its description. The user can type their own through "Other".

**Done when:** you have a title and a kebab-case slug of at most 40 characters.

## 3. Repo config
Check for `.sdlc/config.json`.
- Present: read it and move on.
- Missing: detect commands from `package.json` scripts, `Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `app.json` (Expo), and similar. Fill the shape of `${CLAUDE_PLUGIN_ROOT}/templates/config.json` (`test`, `build`, `start`, `seed`, `appTypes`, `maxParallel`, `autoCommit`). Ask with AskUserQuestion, one question per uncertain field (test command first), recommended detection first, with the proposed JSON as a preview. Write `.sdlc/config.json`, then commit it on the current branch: `git add .sdlc/config.json && git commit -m "chore: add cairn config"`.

**Done when:** `.sdlc/config.json` exists and is committed, and its `test` command is non-empty.

## 4. Create the plan
Run `cairn new <slug> --title "<title>"`. The output prints the plan worktree path.

**Done when:** the command exits 0 and you have the worktree path.

## 5. Tell the user where the plan lives
Tell the user the plan worktree path in one line. Never move the session into the worktree with a worktree-entering tool: a session locked to a worktree blocks its subagents from editing and committing in task worktrees. You stay at the repo root, and every later `cairn` command runs as `cd <plan worktree> && cairn <command>`.

Confirm with `cd <plan worktree> && cairn status --json` that the stage is `discover`.

**Done when:** the user has the worktree path and the stage is `discover`.

## 6. Continue
Tell the user in one line that the plan exists and discovery starts. Run `cd <plan worktree> && cairn next --json` and follow the procedure it names (discover).

**Done when:** the discover procedure is running.
