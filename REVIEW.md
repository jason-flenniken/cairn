# Reviewing cairn

<!--
Every cairn reviewer reads this file before the diff. Code Review for GitHub reads REVIEW.md too; for the local /code-review, import it from CLAUDE.md with @REVIEW.md.
Keep it short: what failure looks like here, what to skip, and the rules learned over time.
-->

## What failure looks like here
- **Docs that lie.** Procedures, agents and references are the program agents run. A line made untrue by a change misleads every later plan, so a stale line in `plugins/cairn/procedures/`, `agents/`, `references/`, `README.md` or `CLAUDE.md` is Required.
- **A change users never get.** People install from GitHub and get a copy cached by `version` in `plugins/cairn/.claude-plugin/plugin.json`. A behavior change without a version raise never reaches them.
- **A stale bundle.** `bin/cairn` runs `plugins/cairn/dist/cairn.mjs`. A change in `plugins/cairn/cli/src/` without a rebuilt, committed bundle ships the old CLI.
- **State written by anything but the CLI.** Only the CLI writes a plan's `state.json`. A procedure, agent or mod change that writes it, or tells the model to, is Critical.
- **Machinery talk to the user.** User-facing text follows `plugins/cairn/references/reporting.md`: outcome first, plain words, no internal ids or nouns like envelope, gate, wave or dispatch.

## Always check
- `plugins/cairn/types/index.d.ts` has no `import`, and declares every `$.state` key the mod uses; `claude plugin validate plugins/cairn` rejects it otherwise.
- A procedure or reference wording change keeps the doc-assertion tests (`*-doc.test.ts`, `procedures.test.ts`, `skills.test.ts`, `templates.test.ts`) passing, and any assertion it changes was changed on purpose.
- Changes under `plugins/cairn/hooks/` respect the engine limits and guard formats in `plugins/cairn/hooks/NOTES.md`.
- New approval stops: PRD, plan and ship are the only three. A change that adds a fourth, or a repeated re-review round, is Required.
- Plan folders use the local date, not UTC.

## Skip
- `plugins/cairn/dist/cairn.mjs`: generated. Review `plugins/cairn/cli/src/` instead, and only check that the bundle was rebuilt.
- `docs/cairn/plans/**/state.json` and `docs/cairn/OVERVIEW.md`: written by the CLI.
- `sources/`: reference material borrowed from other projects, not part of the build.
- `graft/`: a gitignored code index.
- `package-lock.json`, unless a dependency was added.

## Nits
At most 3 Nit findings per review. Style the surrounding code already uses is not a finding.

## Rules learned
<!--
Added at ship, only with the user's yes, when a review kept flagging the same thing or missed something.
Format: - **YYYY-MM-DD · <area>** — <rule>. *Why:* <what happened>.
Newest at the bottom. Don't delete a rule that stops applying: strike it through and say why.
-->
