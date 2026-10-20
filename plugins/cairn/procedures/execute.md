# Execute

Orchestrate the current phase: start every ready slice, review it, fix it, merge it, repeat until the phase has no remaining slices.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`; model choices follow `references/model-tiers.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

You run in the plan worktree on the plan branch `sdlc/<slug>`. You are the only one who merges, and the only one who runs `cairn`. Agents get a worktree path and a brief; they never touch `docs/sdlc/`.

## 1. Check
Run `cairn status --json`. The stage must be `execute`. Any other stage: say which and run `cairn next --json`. Stop this procedure.
- Paused: tell the user the plan is paused and stop. `/cairn:resume` continues it.
- Note the plan slug, the plan branch, the plan worktree path, and the current phase.

**Done when:** the stage is `execute`, the plan is not paused, and you hold the four values above.

## 2. Resume what is in progress
Slices already `in_progress` carry a recorded substep. Continue each from there; starting over wastes finished work.
- `implementing`: check whether an implementer is still running for it. If not, dispatch a fresh implementer (step 4) with a note to inspect the worktree's existing commits first.
- `reviewing`: run step 5.
- `fixing`: run step 6.
- `merging`: run step 7.
- `blocked`: run step 8.

**Done when:** every in-progress slice is back in the loop at its recorded substep.

## 3. Find ready slices
Run `cairn ready --json`. For each ready slice run `cairn slice start <id>`; it prints the slice worktree path. Cap parallelism at what `cairn ready` returns.

**Done when:** every ready slice is started and you hold its worktree path. An empty ready list with no in-progress slices means the phase is finished: go to step 9.

## 4. Implement
For each started slice, dispatch the `implementer` agent in the background, with an explicit `model` from the slice's complexity (simple: haiku, standard: sonnet, complex: opus). Build the brief from these parts and nothing else:
1. The slice's `### Slice: <id>` section from `plan.md`, verbatim.
2. The PRD requirements the slice covers, quoted verbatim from `prd.md`, with the matching acceptance criteria and unhappy paths.
3. The plan's Global constraints, verbatim.
4. The slice worktree path and the plan branch name (`sdlc/<slug>`).

Then run `cairn slice step <id> implementing`.

**Done when:** each started slice has a running implementer, and you've told the user in 1-3 lines which slices started and on which model tier.

## 5. Review
When an implementer reports, read its status line.
- `DONE` or `DONE_WITH_CONCERNS`: run `cairn slice step <id> reviewing`. Dispatch the `slice-reviewer` agent (`model: sonnet`) with: the slice section, the covered requirements, the Global constraints, the implementer's report, and the diff command `git -C <worktree> diff <plan-branch>...HEAD`. Concerns from the implementer go to the reviewer as claims to verify.
- `NEEDS_CONTEXT`: answer from the PRD, plan, or `decisions.md` and send it to the implementer with SendMessage. Ask the user only when the documents don't answer it (AskUserQuestion, recommended first; record with `cairn decide`).
- `BLOCKED`: step 8.

**Done when:** each reported slice has a reviewer verdict of PASS or FIX.

## 6. Fix
On FIX: run `cairn slice step <id> fixing`. Each call counts one fix round; the CLI refuses past round 5.
- Rounds 1-3: send the findings back to the same implementer with SendMessage (or a fresh implementer on the same worktree when the old one has ended).
- Rounds 4-5: dispatch a fresh implementer one tier up (see `references/model-tiers.md`), with the brief plus every finding so far.
- When the CLI refuses a sixth round, stop work on that slice, summarize the recurring problem to the user, and ask with AskUserQuestion: Re-plan this slice / Fix by hand / Accept as is (recorded as a deviation) / Pause.

After the implementer reports DONE, return to step 5 for a re-review limited to the findings and the fix diff.

**Done when:** the slice has a PASS verdict, or the user has chosen how to proceed.

## 7. Merge
On PASS: run `cairn slice step <id> merging`. From the plan worktree:
1. `git merge --no-ff sdlc-slice/<slug>/<id> -m "merge slice <id>"`.
2. Slices never change `docs/sdlc/`, so the merge leaves it alone. If git reports a conflict under `docs/sdlc/`, keep the plan branch's side (`git checkout --ours -- docs/sdlc`) and tell the user the slice broke that rule. Don't reset or check out `docs/sdlc/` any other way: `state.json` there has live changes that aren't committed.
3. On conflicts, resolve them using the slice scopes in `plan.md`; when the resolution involves a judgment call, report it per the deviations rule.
4. Run `cairn slice done <id>`. The CLI runs the repo's test command in the plan worktree.

If `cairn slice done` is refused because tests fail, send the failures to a fresh implementer on the merged tree (`cairn slice step <id> fixing`), then merge again.

**Done when:** `cairn slice done <id>` exits 0. Report in 1-3 lines: the slice, the test count, what starts next.

## 8. Blocked
Run `cairn slice step <id> blocked --note "<what blocks it>"`. Pick the cheapest remedy:
- Missing information: answer it from the documents or ask the user, then restart the implementer.
- Task too hard: restart with a fresh implementer one tier up.
- Slice too big or wrong: tell the user and offer a re-plan (edit `plan.md`, then `cairn plan load --replan`, then ask for approval of the changed plan).

**Done when:** the slice is unblocked and back at `implementing`, or the user chose to re-plan or pause.

## 9. Loop
After every completion, return to step 3. Check `cairn status --json` between rounds; when it shows paused, let current sub-steps finish, start nothing new, and stop.

When `cairn ready` is empty and no slice is in progress, the phase has no remaining slices.

**Done when:** the phase has no remaining slices. Then run `cairn next --json` and follow the procedure it names (phase-end).
