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

## Real architecture forks
Before the PRD is approved, a decision the user would want to weigh in on is a candidate for the one round of questions in discover: give the options with the actual tradeoff, a recommendation and its reason, 2-4 options, the recommended one first and labelled "(Recommended)". After the PRD is approved nothing is asked (`references/autonomy.md`): take the recommendation, record it (`cairn decide "Assumed: …"` or `--call`), and say it in line 1 of the message, as a deviation. The pull request lists it for the user.

## Relaying subagent results
Restate every subagent result in this contract's terms. Subagents run on a bounded prompt and do not know this contract, so their wording is raw material. Keep their findings, `path:line` evidence, and counts; drop their ids, process narration, and self-praise.

## Stops
There are two stops in a run: the PRD approval, and the open pull request. At the PRD, present a short summary (about 5 lines) and the approval menu, then wait for the answer. At the end, send one short message (the PR link, ready or draft, how many calls were made for the user, how many parts are not done) and wait for the merge or for notes. Everything between is hands-off: red, blocked and stuck work is recorded and the run goes on. A finished phase is not a stop: when the tests are green, say one line (what finished, the new-suggestions count) and keep going. A pause is the user's, never yours.

A reply with no tool call ends your turn, so it is a stop. Put every progress line in the same reply as the next tool call. Never end a reply with "Next: …" and no call to do it.

## Refusals
When the CLI refuses a command (exit code 2), read what it says is missing, do that, and rerun. When the refusal names `--call` (a choice about how to build) or `--not-done` (part of the goal that is unmet after the allowed fix attempts), rerun with that flag and a plain reason, as `references/autonomy.md` describes. There is no way to override a refusal, and none is needed.

The PRD approval answered in the menu is recorded before the menu's answer reaches you: read `state.approvals` once, right away. When a cairn note says the approval was not recorded, ask the tagged approval menu once more; when the note says the session may run an outdated cairn, tell the user to restart the session. Never end a turn asking the user to press Approve in the pane: an approval from the pane continues the chat by itself. Give the `--human` terminal command (it asks the user to press Enter) only when `modActive` is false.

## Agent titles
Every `Agent` call sets `description` to `"<Role> · <task name>"`, where Role is one of Build, Review, Fix, Check, Research, Record. The pane shows it as the card title. Examples: "Build · Cart API", "Review · Cart API", "Fix · Cart API", "Check · acceptance", "Research · payment providers", "Record · completion".

Check is also the name of the stage after Build, so the Check role is only for work in that stage (acceptance, screenshots). Research in discover or plan is "Research · <topic>"; an on-track check during Build is "Review · on-track <phase>".

## Build and Check
In anything the user reads, the end of a phase during Build is "wrapping up phase N" (its full suite, and the on-track check at Polished). Never call it "checks" or "the check": the user reads that as the Check stage. Once every task is merged, the plan is in Check; say so ("All 14 tasks are merged; the plan is in Check, running the full suite"). Never say the plan is in Check, or about to run its checks, while the pane still shows Build.

## Suggestions
Quality work worth doing later is logged, not argued about now: `cairn suggest add --area <tests|security|perf|quality|ux|docs> --where <glob> --text "…" --from <source>`. Log it in one line and move on. The count shows up in the phase summary, at ship, and in `/cairn:suggestions`.

## Plain words

Use the right-hand word in anything the user reads.

| Don't say | Say |
| --- | --- |
| slice | task |
| drift | out-of-scope edits |
| suggestion | recommended follow-up |
| direction verdict / verdict | on-track check |
| substep | step |
| fix round | fix attempt |
| worktree, evidence, gate, envelope | leave out of user text; say what happened |
