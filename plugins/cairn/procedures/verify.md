# Check

Prove the finished build works: tests and build, then one pass over the PRD's acceptance checks.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn status --json`. The stage must be `verify`. Any other stage: say which and run `cairn next --json`. Stop this procedure.

**Done when:** the stage is `verify`.

## 2. Tests and build
Run the repo's test command (`test` in `.sdlc/config.json`) in the plan worktree, and the build command when `build` is set. Read the output and the exit code. With no test command, say so in one line and continue.

**Done when:** you hold the pass/fail counts from a run made in this step. On failure, fix in place (step 4) before continuing.

## 3. Acceptance checks
Dispatch the `acceptance-checker` agent (`model: sonnet`, `description` "Check · acceptance") with the path to `prd.md` and the plan worktree path. It walks each requirement's `Check:` and returns met / met but untested / not met, each with `path:line`.

- **Not met:** blocking. Fix it in place (step 4).
- **Met but untested:** log it as a suggestion and move on: `cairn suggest add --area tests --from check --where <glob> --text "<what lacks a test>"`.

**Done when:** every requirement has a verdict, and every "met but untested" item is logged.

## 4. Fix what is blocking
Skip when tests are green and nothing is not met. Otherwise dispatch one `implementer` (`model: sonnet`, `description` "Fix · acceptance") on the plan worktree itself. It commits directly on the plan branch; there is no new task, phase, or re-plan. Brief it with the failing tests or the unmet requirement and its Check line, and tell it to add a test for the fix. Then rerun step 2 and step 3's unmet items once more.

If it is still failing after that one attempt, stop and ask the user with AskUserQuestion: Fix by hand / Accept as is (noted in the record) / Pause.

**Done when:** tests are green and no requirement is not met, or the user chose how to proceed.

## 5. Record the result
Run `cairn evidence verify pass --note "<tests: N passing; M requirements met, K untested>"`, or `cairn evidence verify fail --note "<one line>"` when the user stops here. Then run `cairn advance`.

**Done when:** the stage is `review`. Then run `cairn next --json` and follow the procedure it names.
