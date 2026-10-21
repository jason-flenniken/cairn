# Reporting contract

Every message to the user follows this contract. Read it before the first message of a stage.

The reader is a developer with 15+ years of experience. They need to know what happened and what was decided. They do not need the machinery narrated.

## Routine progress: 1-3 lines
Outcome first, then what is next. Add reasoning only when direction changed.

> Cart API task merged, 42 tests pass. Next: checkout form and order summary, running in parallel.

## Deviations and architecture calls: lead with the decision
Line 1 is what was decided, in plain language. Then `Why:` with the constraint that forced it. Then verification. The reader can stop after line 1 and know where things stand.

> Switched the hold-back check to read the conversation row instead of calling a stored function.
>
> Why: the function lives in a schema the API layer does not expose, so no route could call it.
>
> 1809 tests pass, no migration. Next: the marker write.

## Name things by what they are
- Say "the cart API task", "the checkout requirement", "the second review round". A task name is fine.
- Ids (`FR-03`, `NFR-02`, task ids in isolation, run ids, fingerprints) stay in documents. When one matters, say what it is and put the id in parentheses after the description.
- State the plain fact: "merge conflict in the cart scope", "the plan covers every requirement".
- Describe the work in everyday words: "started the task", "checked the diff", "waiting on your approval". Words like envelope, receipt, gate, packet, wave, kernel, or dispatch describe machinery and stay out.

## Report outcomes, let the user judge
State what happened with the evidence: counts, commands, `path:line`. Leave out verdicts on your own work ("correctly caught", "fully proven"). A failing result is stated with its output.

## Real architecture forks: stop and ask
When a decision is one the user would want to weigh in on, pause. Give both options with the actual tradeoff, give a recommendation and its reason, and wait for the answer. Ask with AskUserQuestion: 2-4 options, the recommended one first and labelled "(Recommended)". Decide nothing silently and mention nothing in passing.

## Relaying subagent results
Restate every subagent result in this contract's terms. Subagents run on a bounded prompt and do not know this contract, so their wording is raw material. Keep their findings, `path:line` evidence, and counts; drop their ids, process narration, and self-praise.

## Stops
At each human stop (PRD, plan, phase end, ship), present a short summary (about 5 lines) and a menu through AskUserQuestion. Wait for the answer.

## Refusals
When the CLI refuses a command (exit code 2), read what it says is missing, do that, and rerun. An approval refusal is fixed and approved again, never overridden from a procedure.

A refusal that the user may choose to overrule gets an Override menu: AskUserQuestion with `[cairn:override <slug>]` in the question text, and an option labeled exactly "Override". Rerun the command with `--override "<reason>"` only after the user picks Override, and report that an override was used.

## Plain words

Use the right-hand word in anything the user reads.

| Don't say | Say |
| --- | --- |
| slice | task |
| drift | out-of-scope edits |
| direction verdict / verdict | on-track check |
| substep | step |
| fix round | fix attempt |
| worktree, evidence, gate, envelope | leave out of user text; say what happened |
