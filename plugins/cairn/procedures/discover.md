# Discover

Interview the user until no open decision remains. Research supplies the facts; the user supplies the decisions.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn status --json`. The stage must be `discover`. Any other stage: say which stage the plan is in and run `cairn next --json` to route there. Stop this procedure.

**Done when:** the stage is `discover` and you know the plan slug and title.

## 2. Research first
Dispatch these in parallel, each with `model: sonnet`, each returning facts with `path:line` or URL:
- Explore agent: codebase facts relevant to the request (stack, existing modules, patterns, tests, conventions).
- Explore agent: prior work in `docs/sdlc/` (earlier plans, PRDs, `RECORD.md` files) and `docs/sdlc/product/PRD.md` (non-goals, NFRs, must-not-trade-off).
- Web research (general-purpose agent, `model: sonnet`) only when the request touches an external API, standard, or competitor.

Read `decisions.md` in the plan directory; it may hold earlier answers.

**Done when:** you hold a fact list and a list of inherited constraints, and you can name the open decisions.

## 3. Build the decision list
List every decision the PRD will need, as questions: scope edges, users and actors, data and state, interfaces, failure behavior, security, performance numbers, rollout. Order them by dependency: a decision that changes other questions goes first. Drop any question the research already answers; mention those facts to the user in one line.

**Done when:** an ordered list of open decisions exists, each with your recommended answer.

## 4. Ask one decision at a time
For the first open decision:
1. Ask with AskUserQuestion: 2-4 options, the recommended one first and labelled "(Recommended)", each with a one-line consequence. Add a preview to any option that is visual or structural (a layout, a schema, a flow, a file tree).
2. Record it immediately: `cairn decide "<question>" "<answer>" --why "<reason in the user's terms>"`.
3. Re-walk the list. An answer can open new questions or close others. Add or drop entries, keeping dependency order.

Repeat until the list is empty. If an answer is "I don't know", research it or recommend and record the recommendation as the decision with the user's confirmation.

**Done when:** every entry is decided and recorded, and no question that research could answer was put to the user.

## 5. Confirm completeness
Run one last pass: for each of users, data, failure paths, security, performance, and non-goals, check `decisions.md` has an answer. Ask the user about any gap. Show a 5-line summary of what was decided.

**Done when:** each of those six topics has a recorded decision or an explicit "not applicable" decision.

## 6. Advance
Run `cairn advance`. It needs at least one decision recorded. If refused, follow its message.

**Done when:** the stage is `prd`. Then run `cairn next --json` and follow the procedure it names.
