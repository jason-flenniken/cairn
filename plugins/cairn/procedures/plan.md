# Plan

Have the approved PRD turned into proofs (the runnable end state) and phases of vertical tasks, loaded, seen failing, and locked, with no stop: the user approved the PRD, and the run is hands-off from there (`references/autonomy.md`). The main thread routes; the proof-writer and the plan-writer hold the documents.

Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

**Nothing is asked here.** A question the proof-writer, the plan-writer or the plan-reviewer raises "for the user" is decided by you, from the PRD and `decisions.md`, and recorded: `cd <plan worktree> && cairn decide "Assumed: <question>" "<answer>" --why "<why, and why it is easy to undo>"`. The pull request lists these under "Calls made for you". The writer gets the answer by SendMessage, or a fresh one with the same paths when it has ended.

## At this level
Read `level` from `cairn status --json`; `references/levels.md` has the full table. 
- Proofs: run step 2a whenever `cairn status --json` shows `state.endProofs.required` (the user chose proofs when the plan started). Otherwise skip it unless the user asks for proofs now; a plan that loads `proofs.md` enforces them from then on.
- MVP: few, large vertical tasks, usually one phase, no Test cases lists; risky tasks still get `risky: true`, and the writer files the areas it leaves untested with `cairn suggest add --kind hardening --area tests --from plan --where <glob> --text "<what to cover and why>"`. Tell the writer the level in the brief; it holds the rules.
- Standard: as written below.
- Polished: every task lists Test cases, each naming the failure mode it pins, and step 4 runs the `plan-reviewer` fresh read.
- A level raised after the plan was loaded: run the plan again at the new level (`cairn plan load --replan --call "<why>"`).

## 1. Check
Run `cairn status --json`. The stage must be `plan`. Any other stage: say which and run `cairn next --json`. Stop this procedure.

**Done when:** the stage is `plan`. If `plan.md` exists, step 3 is a revision: brief a writer to revise it.

## 2. Explore
Dispatch `researcher` agents (`model: sonnet`, `description` "Check · <area> research") in parallel, split by area the PRD touches. Each gets the path to `prd.md`, its area, and `research/<area>.md` in the work folder (`<plan worktree>/.cairn/work/<slug>/`) to write to. Each writes: existing modules and their interfaces, patterns to follow, test layout and runner, files likely to change, and refactors that would make the change easier (prefactoring), with `path:line` evidence. You do not read those files; the plan-writer does. Read only the short returns.

**Done when:** every researcher returned and you hold the paths of their files.

## 2a. Write the proofs
Run `cd <plan worktree> && cairn step drafting`, sent in the same message as the dispatch of the `proof-writer` agent (`model: sonnet`, effort high; `opus` at Polished; `description` "Build · proofs") with paths only: the plan folder, the plan worktree, the research files, `.cairn/config.json`, and the template `${CLAUDE_PLUGIN_ROOT}/templates/proofs.md`. It writes the proof code (committed on the plan branch) and `proofs.md`, and returns at most 8 lines. Decide its questions yourself and record each with `cairn decide "Assumed: …"`; send the answers back with SendMessage. UI proofs judge screenshots against a written look, or against a mockup when the PRD or the decisions point at one.

**Done when:** the proof-writer returned, `proofs.md` exists, and its questions are decided.

## 3. Brief the writer
Run `cd <plan worktree> && cairn step drafting` (so the pane shows the plan is being written), sent in the same message as the dispatch of the `plan-writer` agent (`model: opus`, `description` "Build · plan") with a brief of paths, no pasted content: the plan folder, `prd.md`, `decisions.md`, the research files, `proofs.md` when it exists (tasks build toward its proofs; `cairn plan load` loads both files), `issues/` when `state.linear` is set, the level, `foundational` when the status shows it, and the template `${CLAUDE_PLUGIN_ROOT}/templates/plan.md`. The writer follows the slicing rules (its own prompt holds them), writes `plan.md`, runs `cairn plan load` and fixes its refusals, and returns at most 10 lines: the phases and task count, the longest-chain line `plan load` printed, the `Opus builds:` line when it printed one, any warning about other plans, questions it needs decided, and the path.

You never edit `plan.md` yourself. When the longest chain is over half the tasks, send the writer one line asking for a contract-first split, and let it reload. Decide its questions yourself, record each with `cairn decide "Assumed: …"`, and send the answers to the writer with SendMessage (or a fresh `plan-writer` with the same paths, when it has ended).

**Done when:** the writer returned, its `cairn plan load` exited 0, and every question it raised is decided.

## 3a. See the proofs fail
Only when step 2a ran. Send the proof-writer one line with SendMessage (or dispatch a fresh one with the same paths): "The plan is loaded: run cairn prove and confirm each proof fails for the right reason." It fixes any proof that fails for the wrong reason, reloads, and returns. `cairn advance` refuses until each new proof has been seen failing (a guard, `expect: pass`, has been seen passing).

**Done when:** the proof-writer says every proof fails for the right reason, and `cairn prove list` shows no proof as `not run`.

## 4. Fresh read (Polished)
Standard and MVP skip this step. At Polished: run `cd <plan worktree> && cairn step checking`, sent in the same message as the dispatch of `plan-reviewer` (`model: sonnet`, `description` "Review · plan") with the paths to `prd.md` and `plan.md` and the report path `<work folder>/reports/plan-review.md`. It ends with the counts, the questions for the user and the report path. Send that report path to the writer with SendMessage: it applies the answered and minor items, reloads, and returns only what is for the user. Decide those yourself, record each as `Assumed:`, send the answers to the writer, and confirm its reload exited 0.

**Done when:** the writer's reload succeeded after the review, or the level skips the step.

## 5. Put the plan in Linear: decide it
Only when `.cairn/config.json` has a `linear` block and `cairn status --json` shows no `state.linear`. Nobody is asked. A repo with a `linear` block wants its plans in Linear, but `cairn linear publish` needs a project name and the config holds none. Take it from the request or `decisions.md` when they name one.
- A project is named: record `cd <plan worktree> && cairn decide "Assumed: put this plan in Linear" "yes, in <project>" --why "the repo has a linear block in .cairn/config.json"`, then run `cd <plan worktree> && cairn linear publish --project "<project>"`. Then dispatch the `linear-sender` agent (`model: haiku`, `description` "Record · Linear tickets"; only when none is already running, else wait for it first) with the plan worktree path and the plugin root; it files the epic, then the tickets under it, then the blocked-by links between them, following `procedures/linear-sync.md`. Wait for it here: the plan's tickets need their keys. From then on the plan moves its tickets like one pulled in from Linear.
- No project is named: record `cairn decide "Assumed: leave this plan out of Linear" "no project named" --why "the config has a linear block but names no project; cairn linear publish can file it later"` and go on.
- Either way the pull request says so, under "Calls made for you".

**Done when:** the call is recorded, and when it was yes the epic and tickets are filed.

## 6. Advance
Run `cairn status --json` and check there are no warnings about `plan.md`. If `plan.md` changed since loading, have the writer reload it (SendMessage) and check again.

Then run `cairn advance`. It locks the plan and the proofs; there is no approval. Tell the user in one line that the plan is loaded (the phases and task count) and the build starts. Do not ask for anything and do not wait.

**Done when:** the stage is `execute`. Then run `cairn next --json`. Follow the procedure it names.
