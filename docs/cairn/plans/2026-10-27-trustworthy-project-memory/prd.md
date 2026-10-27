# PRD: Trustworthy project memory

> Plan: trustworthy-project-memory. Keep it short. Every requirement has a stable id and a one-line acceptance check.

## Problem
cairn's project memory, shipped in 0.6.0, splits a repo into code areas. Each area gets a living doc (rules, how it works, gotchas), plus a separate set of "lasting decision" files. A path-matching `recall` command feeds both to agents, and a close-time check demands that area docs be edited. That gives developers and agents two overlapping layers that describe the code. Both go stale as later plans change old work, and nothing checks that they are still true. As plans pile up, more of that material reaches every new session. What a developer actually wants is simpler: what each plan built and why. What an agent wants is a short background on past work. The code is the source of truth for how things work now.

## Solution
Project memory becomes plan history plus a developer-friendly, detailed changelog. Each plan still keeps its folder and `RECORD.md`. At ship, the recorder also writes the plan's changelog entry, a short paragraph covering:
- what was built
- why
- the big rocks a developer would care about (changed an API, added a model, reworked encryption)

The entry goes in the same PR the user approves. `docs/cairn/OVERVIEW.md` becomes that changelog, newest first. A new Changelog tab in the pane shows it at any time, nicely formatted, with each entry linking to its record. Every new session starts with the five most recent entries and a pointer to the full changelog. Discovery reads the full changelog for context on older work.

The code-structured layer goes away:
- area docs
- `/cairn:map`
- the close-time area check
- `cairn area skip`
- lasting-decision files
- `cairn recall`

A record of what was done is history, so nothing in memory claims "how it works now" and nothing goes stale.

## Requirements

**Changelog entry**
- **FR-01** At ship, the recorder writes the plan's changelog entry alongside `RECORD.md`. The entry is one paragraph of at most 120 words covering what was built, why, and the big rocks (API, data model, security or dependency changes a developer must know). It is committed on the plan branch before the ship approval. Check: after the ship step of a plan, the plan folder contains the entry on the plan branch, and a test asserts the ship procedure and recorder instructions require it.
- **FR-02** Fix plans get a changelog entry too, written at the same point in the fix lane. Check: a test asserts the fix procedure asks the recorder for the entry.
- **FR-03** A plan whose folder has no changelog entry (older plans, other repos) still appears in the changelog, using the first sentence of its record's Why section. Check: a CLI test renders the changelog for a closed plan with a RECORD.md but no entry, and shows that sentence.

**OVERVIEW.md and the session start**
- **FR-04** `cairn render`, and closing a plan, write `docs/cairn/OVERVIEW.md` as the changelog. It has one entry per closed plan, newest first. Each entry has the date, the title, the paragraph and a link to the record. There are no areas or decisions tables. Check: a CLI test renders three closed plans and asserts their order, contents and links, and the absence of Areas and Decisions sections.
- **FR-05** The session-start hook and `cairn index` print the five most recent changelog entries in full. They end with a line pointing to `docs/cairn/OVERVIEW.md` for older work. They print nothing when there are no closed plans. Check: a CLI test with seven closed plans shows exactly the five newest entries plus the pointer line, and shows empty output with none.

**Pane**
- **FR-06** The pane has a Changelog tab beside Now, History and Records. It lists the changelog newest first, with each entry's date and title emphasized and its paragraph wrapped to the pane width, and it scrolls. Check: a mod test switches to the Changelog tab and finds the entries in order with their text.
- **FR-07** Selecting a Changelog entry opens that plan's `RECORD.md` in the pane's document view, the same way the Records tab does. Check: a mod test clicks an entry and finds the record open.
- **FR-08** With no closed plans, the Changelog tab says so in one line. Check: a mod test with no records shows the empty-state line.

**Agents**
- **FR-09** Discovery gives its research agent the path to `docs/cairn/OVERVIEW.md` and asks it to report past plans relevant to the request. It no longer runs `cairn recall`. Check: a doc test asserts discover.md names OVERVIEW.md and does not mention recall.
- **FR-10** Builders and reviewers no longer receive memory input:
  - Implementer briefs drop the "What to respect" part.
  - The review checklist drops the "contradicts a decision in force" item.
  - The task-reviewer and branch-reviewer instructions drop recall.

  Check: a doc test asserts no file in procedures/, agents/ or references/ mentions `cairn recall`, area docs, or decisions in force.

**Removals**
- **FR-11** The following commands and flags are removed:
  - `cairn recall`
  - `cairn area skip`
  - `cairn decide --lasting`, `--promote` and `--replaces`
  - `/cairn:map`

  Each removed command or flag, when used, refuses with a plain message saying it was removed and that the changelog replaces it. Check: CLI tests run each removed command or flag and assert the refusal text. `claude plugin validate plugins/cairn` passes with the map skill gone.
- **FR-12** `cairn close` no longer checks area docs or uncovered code, publishes decision files, or writes History sections. A repo that still has `docs/cairn/system/` or `docs/cairn/decisions/` closes plans without errors or warnings about them, and cairn never modifies or deletes those files. Check: a CLI test closes a plan in a repo containing area docs and decision files. The close succeeds, and the files are byte-identical afterwards.

**This repo**
- **FR-13** In this repo, `docs/cairn/system/` and `docs/cairn/decisions/` are deleted. The six earlier closed plans each get a changelog entry written from their `RECORD.md`. Check: both folders are absent on the branch, and `cairn render` shows a paragraph entry, not a fallback sentence, for all six plans.
- **FR-14** None of this plan's own decisions are published as decision files when it closes. Check: after this plan closes, `docs/cairn/decisions/` does not exist on main.

**Docs and release**
- **FR-15** The README's Project memory section is rewritten. It describes:
  - plan records
  - the changelog and its tab
  - what a session starts with
  - that existing `docs/cairn/system/` and `docs/cairn/decisions/` folders are no longer read and can be deleted

  `references/cli.md` and CLAUDE.md drop the removed commands. Check: doc tests assert the new README section and that cli.md lists none of the removed commands.
- **FR-16** The plugin version in `plugins/cairn/.claude-plugin/plugin.json` is raised, and the committed bundle is rebuilt. Check: the version differs from 0.6.0, and `npm run build` leaves `dist/cairn.mjs` unchanged.

## Non-goals
- A roll-up that condenses older plans, because the user wants it later, not in this plan.
- Deleting area or decision files in other repos, because people may have edited them, and cairn never deletes what it did not just create.
- Checking any doc against the code, because memory no longer makes "how it works now" claims.
- Announcing this as a breaking release, because the user chose the normal version bump.
- Changing `RECORD.md`'s sections or word budget, because the record stays as the detail page.
- Path- or topic-scoped memory, because files change constantly and the user wants a simple high-level overview.

## Open questions
- [x] Is the overview a separate higher-level doc or the area docs? (answer: neither. It is a changelog of what each plan did and why.)
- [x] What does a session start with? (answer: the five newest entries plus a pointer.)
- [x] Is the entry reviewed? (answer: yes. It is written at ship and lands in the PR the user approves.)

## Unhappy paths
- [FR-03] When a plan has neither an entry nor a RECORD.md, the changelog lists its date and title with no paragraph.
- [FR-05] When the changelog cannot be read (a broken record file), the session start prints the entries it could read and never fails the hook.
- [FR-06] When `cairn records --json` or the changelog read fails, the Changelog tab keeps what it last showed.

## Security
- Trust boundaries:
  - Changelog entries are model-written text. They are shown to every later session and rendered in the terminal pane.
  - Old area and decision files in other repos are user-owned files.
- Assets:
  - the integrity of the context every new session starts with
  - the user's own docs in other repos
  - the user's terminal display
- STRIDE:
  - **Model-written entries.** Tampering, through a misleading or instruction-like entry steering later agents, is controlled by the entry landing in the PR the user approves at ship. Information disclosure is controlled the same way: the user sees the entry before merge.
  - **Pane rendering.** Tampering through terminal control sequences in an entry is controlled by stripping control characters before display.
  - **User-owned files.** Tampering or destruction is controlled by FR-12: cairn never modifies or deletes them.
- Misuse cases:
  - An entry contains terminal escape codes that rewrite the pane. Control: strip control characters. Security test: render an entry with an escape sequence and assert it is not emitted.
  - Close runs in a repo with a hand-edited area doc. Control: FR-12. Security test: the files are byte-identical after close.

## Non-functional requirements
- **NFR-01** The session-start memory text stays bounded however many plans exist: at most five entries of at most 120 words each, plus one pointer line.
