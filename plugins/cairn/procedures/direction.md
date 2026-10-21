# Direction

Check whether the code still matches the PRD, with `path:line` evidence for every finding.

Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`. This procedure reads code and writes at most one report file. It edits no source.

Inputs, from the caller:
- A phase id (called from phase end), or
- `all` (every requirement in the plan), `changed` (requirements whose code changed since the last commit), or a list of requirement ids (called from `/cairn:direction`). Empty means `all`.

## 1. Scope
Run `cairn status --json` for the plan slug, worktree, and current phase. Read `prd.md` and `plan.md` in `docs/sdlc/plans/<slug>/`.
- Phase id: the requirements are the union of `covers` across the phase's tasks.
- `all`: every requirement in the PRD.
- Ids: those requirements, checked against the files in the scopes of the tasks that cover them.
- `changed`: run `git status` and `git diff HEAD` in the worktree, and map each changed file to the requirements whose tasks own it.

For each requirement, collect its text, acceptance criteria, unhappy paths, and the code areas (the owning tasks' scope globs). When `docs/sdlc/product/PRD.md` exists, also collect its non-goals, NFRs, and must-not-trade-off items.

**Done when:** you hold a requirement list with criteria and code areas, and the product PRD items or know there are none.

## 2. Check
Split the requirements into groups of two or three. Dispatch one `direction-checker` agent per group, all in one message so they run in parallel, each with `model: sonnet`. Give each: the worktree path, its requirements quoted with criteria and unhappy paths, its code areas, and the product PRD items.

Relay each agent's rows without changing a verdict. A row without `path:line` evidence goes back to the agent; do not fill it in yourself. A requirement an agent could not verify still needs a row, because the CLI refuses a report missing any covered requirement: tell the agent to give it `missing`, or `partial` with the nearest `path:line` and a note that it is unverified. List it under Not verified too.

**Done when:** every requirement in scope has a verdict row with evidence, or a Not verified entry saying why, and unplanned code is listed or stated as none.

## 3. Write the report
Called with a phase id: write `docs/sdlc/plans/<slug>/direction/<phase-id>.md`. Called with `all`, `changed`, or ids: show the report in the reply and write no file.

Sections, in order:
- **Scorecard:** a table, one row per requirement: id, title, verdict, evidence, note.
- **Drift, most severe first:** contradicted, then missing, then partial. For each: what the requirement says, what the code does, `path:line`, and a recommendation: **Fix code** (the requirement is clearly right: security, data integrity, core behavior), **Update spec** (the code is a sensible evolution and the spec is stale), or **Decide** (a product call, especially pulled-forward work or a non-goal breach; name the tradeoff in one line and leave the choice to the user).
- **Unplanned work:** a table of what, where, class, closest requirement, suggested action.
- **Doc drift:** where README, PRD, or plan disagree with each other or the code.
- **Not verified:** what could not be checked, and why.
- **Next steps:** three to five ordered actions.

Then end the file with exactly one fenced block, in this format, built from the agents' rows:

```yaml cairn-direction
requirements:
  - id: FR-01
    verdict: aligned
    evidence: src/cart.ts:42
unplanned:
  - what: debug endpoint for cart dump
    class: unplanned
    evidence: src/debug.ts:5
nfr:
  - id: NFR-02
    verdict: partial
    evidence: src/auth.ts:77
    note: session expiry is 24h, the product PRD says 1h
```

- `requirements` has one row for every requirement the phase covers. A missing row makes `cairn evidence phase` refuse.
- `verdict` is `aligned`, `partial`, `missing`, or `contradicted`. `class` is `pulled-forward`, `unplanned`, `non-goal-breach`, or `supporting`.
- Every `evidence` is `path:line`. Use an empty list (`unplanned: []`) when there is none.
- Never write an overall green, yellow, or red anywhere in the report or the block. The CLI computes it from the rows.

**Done when:** the report exists with every section and exactly one `cairn-direction` block, or (without a phase id) the report is in the reply.

## 4. Record the verdict (phase id only)
Run `cairn evidence phase`. The CLI parses the block, checks every covered requirement has a row with evidence, computes the color, and records it with the current commit.

When it refuses (exit code 2), read the reason and fix the report, never override:
- "no phase is waiting for approval": the phase is not at its approval point. Go back to execute or phase end and finish the phase's tasks first.
- "direction/<id>.md does not exist": write the report (step 3), then rerun.
- A missing row: find the requirement, have a `direction-checker` agent check it, add the row.
- Missing or malformed evidence: read the code, put a real `path:line` on the row.
- A malformed block or more than one block: repair the block.
Then rerun `cairn evidence phase`.

State the color the CLI printed. Do not decide, soften, or restate it as your own judgment.

**Done when:** `cairn evidence phase` recorded a verdict. (Without a phase id, skip this step.)

## 5. Report
Present, in about 8 lines: counts per verdict, the worst drift items each in one line with `path:line`, unplanned work, and what was not verified. With a phase id, add the color the CLI printed. For a report-only run, end by saying nothing was recorded.

**Done when:** the user has the counts and the worst items.
