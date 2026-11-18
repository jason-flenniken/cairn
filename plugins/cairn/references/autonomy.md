# Running without asking

After the user approves the PRD, the run is hands-off. You never ask and never wait. The run ends in an open pull request, and the user reads there what you did. The goal is fixed: the PRD (requirements and "done when") and the proofs. You choose how to reach it. You never change what it is.

## A choice about how to build: decide, and record it
Take the default and record it. The pull request lists each one under "Calls made for you".
- A question the documents almost answer (a name, a message, a default value, which existing pattern to follow, how to split a task): `cd <plan worktree> && cairn decide "Assumed: <question>" "<answer>" --why "<why, and why it is easy to undo>"`.
- A check the CLI refuses and names as a choice about how to build: run the command again with `--call "<what you chose and why>"`. Examples: a fix that touches more files than a fix should, a change in Linear you handled one way, more follow-ups than a plan may leave open.
- A fix attempt: fix, never ask "fix it?". Red tests, a red proof, an unmet requirement and a review finding go straight to a fix implementer.
- A retry: an unreachable registry or a flaky network call gets one retry. If it still fails, note it (`cairn suggest add`) and go on.
- Re-plan, split a task, change a setup, test or build command, stub a dependency that lives outside the plan: do it and record it. The CLI records a changed command by itself.

## Part of the goal that cannot be met: record it, and go on
When a requirement, a proof, a green suite or a review finding is still unmet after the allowed fix attempts (two per task, two for the verify stage, two for the review stage), write it down and keep going. The pull request opens as a draft that lists it under "Not done".
- A check the CLI refuses and names as part of the goal: run the command again with `--not-done "<why; what was tried; the fix you propose>"`.
- A task whose fix attempts are used up: `cd <plan worktree> && cairn task step <id> blocked --note "set aside: <why>; tried: <what>; proposed: <the fix>"`. This sets the task aside. It no longer holds a builder slot or a phase. Keep building every task that does not wait on it. The tasks that wait behind it are left out too, and the pull request lists them.
- A locked proof that is itself wrong: leave it. Add a corrected one with `cairn prove add`, run it green, and pass the wrong, red one with `--not-done`. Say in the note which proof replaces it.
- A secret in the diff: remove it, and say in the pull request that it counts as leaked. Do not ask.

## What you never do
- Edit, replace or retire a locked proof. `cairn prove retire` is always refused.
- Drop, reword or weaken a requirement, or move a "done when".
- Call a red suite green, or record a pass you did not see.
- Hide a gap. A gap you do not record is a lie in the pull request.

## What is the user's
Only three things, and none of them is a question mid-run:
- The PRD approval, before the run starts.
- An edit to the PRD. If notes change a requirement, edit `prd.md` and get the PRD approved again.
- The merge. Merging the pull request is the sign-off.

Everything else in the run is yours to decide. Do not ask in plain text, with a menu, or by ending your turn on a question. A message with no question in it ends the run: the pull request link, whether it is ready or a draft, and how many calls were made and how much is not done.

## Handling agents that ask
An implementer or reviewer that returns `NEEDS_CONTEXT` or `BLOCKED` gets its answer from the documents (PRD, plan, `proofs.md`, `decisions.md`). When they do not answer it, take the default and record it as above. When even that cannot let the task go on, set the task aside. Never relay the question to the user. A resumed agent carries the conversation from before: dispatch a fresh one from its report when the fix brief changes.
