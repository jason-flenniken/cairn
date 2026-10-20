# Reporting contract

Every message to the user follows this contract. Read it before the first message of a stage.

The reader is a developer with 15+ years of experience. They need to know what happened and what was decided. They do not need the machinery narrated.

## Routine progress: 1-3 lines
Outcome first, then what is next. Add reasoning only when direction changed.

> Cart API slice merged, 42 tests pass. Next: checkout form and order summary, running in parallel.

## Deviations and architecture calls: lead with the decision
Line 1 is what was decided, in plain language. Then `Why:` with the constraint that forced it. Then verification. The reader can stop after line 1 and know where things stand.

> Switched the hold-back check to read the conversation row instead of calling a stored function.
>
> Why: the function lives in a schema the API layer does not expose, so no route could call it.
>
> 1809 tests pass, no migration. Next: the marker write.

## Name things by what they are
- Say "the cart API slice", "the checkout requirement", "the second review round". A slice name is fine.
- Ids (`FR-03`, `NFR-02`, slice ids in isolation, run ids, fingerprints) stay in documents. When one matters, say what it is and put the id in parentheses after the description.
- State the plain fact: "merge conflict in the cart scope", "the plan covers every requirement".
- Describe the work in everyday words: "started the slice", "checked the diff", "waiting on your approval". Words like envelope, receipt, gate, packet, wave, kernel, or dispatch describe machinery and stay out.

## Report outcomes, let the user judge
State what happened with the evidence: counts, commands, `path:line`. Leave out verdicts on your own work ("correctly caught", "fully proven"). A failing result is stated with its output.

## Real architecture forks: stop and ask
When a decision is one the user would want to weigh in on, pause. Give both options with the actual tradeoff, give a recommendation and its reason, and wait for the answer. Ask with AskUserQuestion: 2-4 options, the recommended one first and labelled "(Recommended)". Decide nothing silently and mention nothing in passing.

## Relaying subagent results
Restate every subagent result in this contract's terms. Subagents run on a bounded prompt and do not know this contract, so their wording is raw material. Keep their findings, `path:line` evidence, and counts; drop their ids, process narration, and self-praise.

## Stops
At each human stop (PRD, plan, phase end, ship), present a short summary (about 5 lines) and a menu through AskUserQuestion. Wait for the answer.

## Refusals
When the CLI refuses a command (exit code 2), read what it says is missing, do that, and rerun. Pass `--override` only when the user explicitly chose it, and report that an override was used.
