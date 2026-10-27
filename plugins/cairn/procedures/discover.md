# Discover

Interview the user until cairn can predict their next answers: the goal first, then the decisions it implies. Research supplies the facts; the user supplies the decisions.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## At this level
Read `level` from `cairn status --json`; `references/levels.md` has the full table. 
- MVP: run a short interview. Ask the goal questions in step 4, then only the one flow that must work and the trust boundaries in step 6. Skip step 4b (fresh-eyes challenge), step 5 (goal implications) and the 2b follow-up match; still show the read-back card (step 7) and record it.
- Standard: everything below, as written.
- Polished: everything below, as written. In step 4b the challenger compares three approaches, each with its cost and risk.
- Hardening items for the same area as this plan are offered as scope in step 2b: run `cairn suggest list --open --for <path>` and treat them as follow-ups.

## 1. Check
Run `cairn status --json`. The stage must be `discover`. Any other stage: say which stage the plan is in and run `cairn next --json` to route there. Stop this procedure.

**Done when:** the stage is `discover` and you know the plan slug and title.

## 2. Research first
Dispatch these in parallel, each with `model: sonnet`, each returning facts with `path:line` or URL. Set each Agent `description` per `references/reporting.md` (for example "Check · discovery research"):
- Explore agent: codebase facts relevant to the request (stack, existing modules, patterns, tests, conventions), plus prior work in `docs/sdlc/` and `docs/sdlc/product/PRD.md` (non-goals, must-not-trade-off).
- Web research (general-purpose agent, `model: sonnet`) only when the request touches an external API, standard, or competitor.

Read `decisions.md` in the plan directory; it may hold earlier answers.

**Done when:** you hold a short fact list and can name the open decisions.

## 2b. Offer matching follow-ups
Take the file paths the research found and run `cairn suggest list --open --for <path>`, one `--for` per path or glob. Skip this step when nothing matches.

When some match, ask one AskUserQuestion with `multiSelect: true`: "These recommended follow-ups touch the same files. Which belong in this plan?" One option per match, labelled with its text and `<slug>:<id>`; offer the first four when there are more.
- Each one picked: add it to `decisions.md` as a requirement to carry into the PRD, then run `cairn suggest resolve <slug>:<id> --note "brought into <this plan's slug>"`.
- All the others: run `cairn suggest decline <slug>:<id>...` once. A follow-up declined twice expires on its own.

**Done when:** every match was picked or declined, or none matched.

## 3. Guess and confidence
Before the first question, show one plain-text line: `I think you want <one-sentence guess>. Confidence: NN%.` Below about 70%, add a second line naming what is missing. After each answer, update the confidence in one line as it rises.

**Done when:** the guess and confidence are shown to the user.

## 4. Goal questions
Ask one at a time, in this order: why, why now, what success looks like, the binding constraint. Skip any research or an earlier answer already settles.
- Use AskUserQuestion: 2-4 options, cairn's guess first and labelled "(Recommended)", its reasoning in the question text or option description. The user can type their own answer via Other.
- An answer that only sounds right ("scalable", "clean") gets one probe: "If you didn't have to justify it, what would you actually want?"
- "Whatever you think" or "I don't know" is re-asked as a two-option choice. Never record cairn's pick as the user's answer.
- Record each answer: `cairn decide "<question>" "<answer>" --why "<reason in the user's terms>"`.

**Done when:** why, why now, success and the binding constraint each have a recorded decision, or are already settled by research.

## 4b. Fresh-eyes challenge
Your guess anchors you and, through the recommended options, the user. One agent that never saw it checks the goal from outside.

You may skip this step only when the goal admits one obvious approach and no design choice (a one-line change, a rename). Record it with `cairn decide "Fresh-eyes challenge skipped" "<reason>" --why "one obvious approach"`; step 7 shows the line under the card, so the user can ask for the challenge with `Fix a line`. When unsure, run it.

Dispatch one `challenger` agent (`model: sonnet`, `description` "Review · approaches"). Give it only: the goal answers from step 4 as recorded, the research fact list from step 2, the repo path, and the depth (`standard` or `polished`, from `level`). Never give it your guess, the confidence line, or a draft of the Outcome. What it is not told is what lets it see past them.

Sort every item it returns:
- **Already answered:** a recorded decision or a research fact settles it.
- **Minor:** any choice works and the user would not notice. Pick one; its set-aside reason names your pick.
- **For the user:** it could change what gets built: another approach, the strongest objection, or an assumption that changes the build if wrong. Ask it in step 6 in the same question format, with the challenger's point and its evidence in the option description. When the user picks another approach, it replaces your guess.

When in doubt, an item is for the user. Disagreeing with your guess is never a reason to set an item aside; it is the reason this step exists. Every item that does not go to the user gets a one-line reason: `cairn decide "Set aside: <item>" "<reason>" --why "fresh-eyes challenge"`. Step 7 shows them under the card.

Update the confidence line in one line. It may go down.

**Done when:** every item the challenger returned is queued for step 6 or set aside with a reason, or the skip is recorded.

## 5. Goal implications
List decisions the goal implies that the user has not raised. Ask one AskUserQuestion with `multiSelect: true`: "Does this goal also mean these?" One option per implication.
- Each one picked: `cairn decide "<implication>" "yes" --why "<what the goal implies>"`.
- Each one not picked: record it as a non-goal with `cairn decide "Non-goal: <implication>" "out of scope" --why "<reason>"`.

**Done when:** every implication shown is recorded as a decision or a non-goal.

## 6. Remaining decisions
One at a time, same question format as step 4, covering:
- Users: who they are.
- Core flow: what they do, start to finish.
- Non-goals: anything not yet recorded.
- Trust boundaries (required): untrusted input, auth, personal data, model output, shell commands, deletes. Say "not applicable" only when you checked each one. Money, migrations and public API belong here too.

Skip anything research already answers; mention it in one line. Order questions by dependency, including the ones step 4b queued. Picked follow-ups from step 2b are decided; do not ask again.

**Done when:** users, core flow, non-goals and each trust boundary have a recorded decision or an explicit "not applicable".

## 7. Read-back card
Show this card, filled from the recorded decisions:

```
Outcome:      <what gets built>
User:         <who it is for>
Why now:      <what makes it urgent>
Success:      <how we will know it worked>
Constraint:   <the binding limit>
Out of scope: <what we will not do>
```

When step 4b set items aside, put them under the card, in the reply and in the preview, those touching the success answer or a non-goal first, so the user can pull one back with `Fix a line`:

```
Set aside (N):
  - <item>: <reason>
```

When step 4b was skipped, put `Fresh-eyes challenge skipped: <reason>` there instead.

Print the card in your reply, then ask "Is this right?" with AskUserQuestion. The card goes with the question, never only before it: the question text includes `[cairn:readback <slug>]`, with the plan slug from `cairn status --json`, and the options are `Yes (Recommended)`, with the whole card as its preview, then `Fix a line`. The pane shows the same card while the question is open, and a press there answers it. Record the card with `cairn decide "Read-back" "<the card>" --why "confirmed by the user"` only after an explicit yes. A fix means update the card and ask again. Silence or "sure, whatever" is not a yes.

After two revisions with no explicit yes, say plainly that something foundational seems to be missing, and ask with AskUserQuestion whether to step back: Step back to the goal questions (Recommended), Keep refining the card, or Pause.

Stop interviewing when you can predict the user's next three answers. If you cannot, ask the question you could not predict before showing the card.

**Done when:** the card is recorded as the last decision, after an explicit yes.

## 8. Advance
Run `cairn advance`. It needs at least one decision recorded. If refused, follow its message.

**Done when:** the stage is `prd`. Then run `cairn next --json` and follow the procedure it names.
