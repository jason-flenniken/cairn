# Verify

Prove the finished build meets the PRD: full tests, then every acceptance criterion and unhappy path traced to evidence.

v0.1 scope. A later version adds the breaker (adversarial unhappy-path run), the first-timer (blind user), and the acceptance runner here.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn status --json`. The stage must be `verify`. Any other stage: say which and run `cairn next --json`. Stop this procedure.

**Done when:** the stage is `verify`.

## 2. Full tests
Run the repo's test command (`test` in `.sdlc/config.json`) in the plan worktree. Read the whole output and the exit code. Run the build command too when `build` is set.

**Done when:** you hold the pass/fail counts from a run made in this step. On failure, add a fix slice (step 4) before continuing.

## 3. Acceptance trace
Dispatch the `acceptance-checker` agent (`model: sonnet`) with the paths to `prd.md` and `plan.md` and the plan worktree path. It walks every Acceptance criterion and every Unhappy path and returns covered / partial / missing, each with `path:line` evidence from tests or code.

**Done when:** every criterion and unhappy path has a verdict with evidence.

## 4. Resolve gaps
For each partial or missing item, ask with AskUserQuestion (grouped when many): Fix it (Recommended) / Accept the gap (recorded as a deviation).
- Fix it: add a fix slice to `plan.md` in a new final phase (own scope, `covers` the requirement, concrete test cases). Run `cairn plan load --replan`, get the user's approval of the changed plan with `cairn approve plan`, run `cairn next --json` to execute it, and return here once its phase is approved.
- Accept: note it for the record's Deviations section with the user's reason.

**Done when:** no item is partial or missing, or each remaining one is accepted with a reason.

## 5. Record the result
Run `cairn evidence verify pass --note "<tests: N passing; acceptance: X covered, Y accepted gaps>"`, or `cairn evidence verify fail --note "<one line>"` when the user stops here. Then run `cairn advance`.

**Done when:** the stage is `review`. Then run `cairn next --json` and follow the procedure it names.
