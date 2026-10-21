# Discover

Interview the user just enough to start: users, the core flow, non-goals, and anything risky. Research supplies the facts; the user supplies the decisions.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn status --json`. The stage must be `discover`. Any other stage: say which stage the plan is in and run `cairn next --json` to route there. Stop this procedure.

**Done when:** the stage is `discover` and you know the plan slug and title.

## 2. Research first
Dispatch these in parallel, each with `model: sonnet`, each returning facts with `path:line` or URL. Set each Agent `description` per `references/reporting.md` (for example "Check · discovery research"):
- Explore agent: codebase facts relevant to the request (stack, existing modules, patterns, tests, conventions), plus prior work in `docs/sdlc/` and `docs/sdlc/product/PRD.md` (non-goals, must-not-trade-off).
- Web research (general-purpose agent, `model: sonnet`) only when the request touches an external API, standard, or competitor.

Read `decisions.md` in the plan directory; it may hold earlier answers.

**Done when:** you hold a short fact list and can name the open decisions.

## 3. Ask one decision at a time
Cover only: who the users are, the core flow, the non-goals, and anything risky (auth, money, deleting data, migrations, public API). Skip anything research already answers; mention those facts in one line. Order questions by dependency.

For each open decision:
1. Ask with AskUserQuestion: 2-4 options, the recommended one first and labelled "(Recommended)", each with a one-line consequence. Add a preview to any option that is visual or structural.
2. Record it immediately: `cairn decide "<question>" "<answer>" --why "<reason in the user's terms>"`.

Stop when the core is clear. If an answer is "I don't know", recommend one and record it with the user's confirmation. Do not interview for completeness: the PRD names what is still open.

**Done when:** users, core flow, non-goals and risky areas each have a recorded decision or an explicit "not applicable".

## 4. Advance
Run `cairn advance`. It needs at least one decision recorded. If refused, follow its message.

**Done when:** the stage is `prd`. Then run `cairn next --json` and follow the procedure it names.
