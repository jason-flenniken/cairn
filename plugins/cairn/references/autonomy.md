# Running without asking

Once the plan is approved, the build runs on its own until the proofs pass. The user defined done (the PRD and the proofs) and approved how to get there (the plan). Between that approval and the ship approval, a question goes to the user only when it is theirs to answer. A menu the user would always answer with the recommended option is not a question: take the default and record it.

## Decide alone, and record it
Take the default and run `cd <plan worktree> && cairn decide "Assumed: <question>" "<answer>" --why "<why, and why it is easy to undo>"`. The ship approval lists these decisions.
- A question the documents almost answer, when the answer is easy to reverse later (a name, a message, a default value, which existing pattern to follow).
- A fix attempt: fix, never ask "fix it?". Red tests at a merge or a phase end, a red proof, an unmet requirement and a review finding all go straight to a fix implementer.
- A retry: an unreachable registry or a flaky network call gets one retry. If it still fails, note it and go on (`cairn suggest add`).

## Set a task aside
A task is set aside when it can't go on without the user: its fix attempts are used up (the CLI refuses another) and its findings or proofs are still red, or it needs an answer that is not easy to undo. Run `cd <plan worktree> && cairn task step <id> blocked --note "set aside: <why>; tried: <what>; question: <the question, with your recommended answer>"`. Then keep building every task that does not wait on it. Tell the user in one line, without asking.

A set-aside task holds its phase open: tasks in later phases wait for it, unless the phase has `overlap`. So the build reaches the one stop below at the end of that phase, not at the end of the plan.

## The one stop
When nothing else can run (no ready task, no agent running) and something is set aside or held, ask once, and end your turn on it. List at most four questions, one per set-aside task or held question, most blocking first, and say how to answer (a reply per task; "go" takes every recommended answer). The user can take hours, and the answer arrives as a new message, so no AskUserQuestion stays open. Each question has the recommended answer first, with what was tried. The usual options for a stuck task are: Re-plan this task (Recommended when another approach exists; name it) / Fix by hand / Accept as is (noted in the record). There is no third fix attempt: the CLI allows two per task. Run `cairn step asking` when you ask and `cairn step clear` when the answer arrives (the build has no other step). Then act on every answer and carry on. A resumed agent would carry the conversation from before the wait: never SendMessage an agent after the user was asked something; dispatch a fresh one from its report.

## Still a stop, every time
- The user's approvals: the PRD, the plan and the ship.
- A change of scope: a re-plan, pulling in or releasing a Linear issue, or changing or removing a proof (proofs are add-only once approved).
- Accepting an open Critical or Required finding, a security finding, or a red proof as is.
- A secret in the diff: remove it, and tell the user it counts as leaked.
