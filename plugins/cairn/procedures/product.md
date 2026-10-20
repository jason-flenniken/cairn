# Product track

Interview the user and write the whole-app PRD on the current branch: `docs/sdlc/product/PRD.md`. Every feature plan inherits it.

Templates live in `templates/`, next to this `procedures/` folder. Talk to the user per `references/reporting.md`. `cairn` is on PATH; if not, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cairn.mjs"`.

## 1. Check
Run `cairn status --json`. Run this on main or the repo's default branch, outside any plan. On a plan branch, tell the user the product PRD belongs on main and stop.

**Done when:** the branch is not a plan branch.

## 2. Initialize
Run `cairn product init`. Read `docs/sdlc/product/PRD.md` (created from `${CLAUDE_PLUGIN_ROOT}/templates/product-prd.md`). If it already has real content, ask with AskUserQuestion: Revise it / Start over / Cancel.

**Done when:** the file exists and the user chose how to treat any existing content.

## 3. Research first
Facts are your job. Dispatch Explore agents (`model: sonnet`) in parallel for: the codebase and README (what exists, stack, conventions), existing docs under `docs/`, and, when the product has competitors or standards worth knowing, a short web search. Each returns facts with `path:line` or URL.

**Done when:** you can state what the product is today in three lines and have a list of facts the interview must not ask about.

## 4. Interview, one decision at a time
Walk the design tree in this order, resolving each branch before the next: vision, users and their jobs, non-goals, non-functional requirements (numbers), must-not-trade-off, roadmap with priorities.

For each decision:
- Ask one AskUserQuestion with 2-4 options. The recommended option is first and ends with "(Recommended)". Put a preview on options that are structural or visual.
- Record the answer straight away in the PRD file's matching section.
- If the codebase or the research answers a question, state the answer and move on without asking.
- Follow the answer's consequences before leaving a branch: a stated user type means asking for its job; a stated NFR means asking for its number.

**Done when:** every section of the PRD has real content from the user's answers, and no branch has an open dependency.

## 5. Read back
Show the PRD in a compact summary (about 8 lines) and ask with AskUserQuestion: Approve and commit / Revise (what?) / Cancel. Revise loops to step 4 for the named section.

**Done when:** the user chose Approve.

## 6. Commit
Run `git add docs/sdlc/product && git commit -m "docs: add product PRD"`. Report in one line that the product PRD is on this branch and that new plans will inherit it.

**Done when:** the commit exists. No stage transition applies to the product track.
