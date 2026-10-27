# Map track

Survey the codebase once, propose areas for the user to approve, draft one doc per area, backfill the lasting decisions from past plans, and render the overview. Run it on main, outside any plan.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn status --json`. Run this on main or the repo's default branch, outside any plan (`plan` is null). On a plan branch, tell the user mapping belongs on main and stop. If `docs/cairn/system/` already has docs, ask with AskUserQuestion: Extend (map only uncovered code) / Start over / Cancel.

**Done when:** the branch is not a plan branch and the user chose how to treat any existing area docs.

## 2. Survey
Dispatch Explore agents (`model: sonnet`) in parallel.
- One clusters the code into 4-12 areas by responsibility. Each area has a kebab-case id, path globs, and a one-line summary. When extending, it covers only code no existing area owns.
- One reads every closed plan's `decisions.md` and `RECORD.md` under `docs/cairn/plans/` (and `docs/sdlc/plans/` if present) and lists the decisions that still hold, each with the paths it governs, its plan slug, and its plan date. It also lists the Findings that read as gotchas.

Every area candidate cites `path:line`.

**Done when:** you have the area candidates, each with a citation, and the list of surviving decisions.

## 3. Propose areas
Show the areas (id, summary, globs) in one compact list. Ask with AskUserQuestion: Approve / Revise (which?) / Cancel. Revise loops on the named areas.

**Done when:** the user chose Approve.

## 4. Draft the docs
Dispatch one `recorder` per area in parallel (`model: sonnet`, `description` "Record · area <id>"). Give each one a brief with: the area id and display name, the one-line summary, the globs, the survey's `path:line` citations, the surviving decisions that govern the area, the relevant past Findings, and the path `${CLAUDE_PLUGIN_ROOT}/templates/area.md`. Tell it to create the doc (not edit an existing one), set `updated` to today, and leave `## History` to cairn. Each writes `docs/cairn/system/<id>.md` from that template: Rules from the code and the decisions, How it works with the entry files, and Gotchas from past records' Findings. History is generated; nobody writes it by hand.

Then run `cairn recall` with each area's globs, quoted so the shell does not expand them (for example `cairn recall "src/cli/**" "src/hooks/**"`), and check that every area appears and no "Area docs with problems:" line is printed. Fix any broken doc and re-run.

**Done when:** every approved area has a doc and `cairn recall` reports no problems.

## 5. Backfill decisions
Pick the decisions from step 2 the user would call architectural. Show the list and let the user drop any in one AskUserQuestion (multiSelect). For each one kept, run:

`cairn decide "<question>" "<answer>" --why "<reason>" --lasting --areas <id>[,<id>…] [--paths "<glob>[,<glob>…]"] --plan <slug> --date <plan date>`

List several area ids or globs comma-separated with no spaces.

Run this after step 4: `cairn decide` refuses area ids that have no doc yet.

**Done when:** each kept decision is published, or the user dropped them all.

## 6. Render and commit
Run `cairn render`, then `git add docs/cairn && git commit -m "docs: map the codebase into area docs"`. Report in one line how many areas and decisions now exist, and that sessions will now load the index.

**Done when:** the commit exists. No stage transition applies to the map track.
