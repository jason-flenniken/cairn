# Decisions: Trustworthy project memory

Append-only. Written by `cairn decide` as each decision is made.

### 1. Why build this?
**Decision:** Project memory is only worth having if it is accurate and lean: new work should load only what is relevant, and the 'how it works' docs must stay true as later plans change code that earlier plans built.
**Why:** user: keeping an accurate record of what was built, the big decisions and how it works is one of cairn's main goals; later plans will touch old work and the docs go out of date
_2026-10-27 19:21_

### 2. Why now?
**Decision:** Make memory trustworthy and lean now, while it is small (9 area docs, 20 decisions), before many plans pile up and stale or excess context starts misleading new work.
**Why:** user: the problem to avoid is that once there are many plans and records, too much spills into the starting context or adds confusion
_2026-10-27 19:23_

### 3. What does success look like?
**Decision:** Area docs stay the single living 'how it works' layer for humans and agents. Every plan that touches an area checks its doc against the code, not just edits it; stale claims and broken references are caught; the session summary and recall stay short however many plans exist. Plan records stay frozen history.
**Why:** user chose area docs as the living layer over a separate higher-level system doc
_2026-10-27 19:25_

### 4. What is the binding constraint?
**Decision:** No new stops for the user: accuracy checks run inside the existing ship step and their findings are fixed there, with no extra approval or interview.
**Why:** user preference: depth goes into thinking and real findings, not more stops
_2026-10-27 19:25_

### 5. Set aside: gate the deep check by diff size so tiny plans stay cheap
**Decision:** The checker reads only the area docs the plan touched and the code they cite, so its cost already scales with the plan; no extra size gate.
**Why:** fresh-eyes challenge
_2026-10-27 19:26_

### 6. Graceful summary cap
**Decision:** yes
**Why:** lean context: the session-start summary must stay useful past its line cap instead of collapsing every decision to a bare id
_2026-10-27 19:28_

### 7. README states the accuracy rules
**Decision:** yes
**Why:** accurate memory: the README's Project memory section says what is checked, when, and what is not
_2026-10-27 19:28_

### 8. Non-goal: ranked, capped recall
**Decision:** out of scope
**Why:** user did not pick it; recall returns pointers and is fine at current size
_2026-10-27 19:28_

### 9. Non-goal: fold old History and OVERVIEW entries
**Decision:** out of scope
**Why:** user did not pick it; generated history stays complete
_2026-10-27 19:28_

### 10. Non-goal: planning step runs recall
**Decision:** out of scope
**Why:** user did not pick it; the README claim is corrected instead
_2026-10-27 19:28_

### 11. Non-goal: one-time verification sweep of the existing 9 area docs
**Decision:** out of scope
**Why:** user did not pick it; docs get checked as plans touch them
_2026-10-27 19:28_

### 12. Non-goal: detect conflicting decisions in force
**Decision:** out of scope
**Why:** user did not pick it
_2026-10-27 19:28_

### 13. How does ship check area docs against the code?
**Decision:** A new read-only fresh-eyes checker gets only the touched area docs and the code they reference and returns each claim as true or stale with evidence; the recorder fixes stale ones inside ship. The CLI also lints references at close: missing files and globs that match nothing.
**Why:** a CLI check proves an edit happened, not that the doc is true; the checker is not the writer, so it is not grading its own work
**Lasting:** areas: project-memory
_2026-10-27 19:28_

### 14. How do area docs reference code?
**Decision:** By path plus symbol (e.g. cli/src/proof.ts verifyProof), not path:line. The lint checks the file exists and the symbol appears in it. Existing path:line references convert as docs are touched; the lint checks only the file for those.
**Why:** line numbers go stale on any edit above them; symbols survive edits and are checkable with a text search
**Lasting:** areas: project-memory
_2026-10-27 19:29_

### 15. Which area docs does the checker read?
**Decision:** Every area doc whose paths cover changed code, plus any other area doc whose references point at a changed file. No periodic sweep.
**Why:** catches most cross-area drift without a separate sweep command
_2026-10-27 19:29_

### 16. When a doc's Rule no longer matches the code, which side wins?
**Decision:** The code. The recorder updates the doc, and the ship approval summary lists each Rule that changed because the code no longer matched (old and new wording), so the user can push back before merge. No new stop.
**Why:** user: the code follows a reviewed plan and PRD, so a mismatch most likely means the doc is out of date; show the change at the existing ship approval
**Lasting:** areas: project-memory
_2026-10-27 19:35_

### 17. What is project memory for? (reframed; replaces decisions 3, 6, 13, 14, 15, 16)
**Decision:** Two things only: (1) for humans, a short, skimmable account of what each plan did and why, readable whether it was today or last week, with a later roll-up across plans; (2) for agents, a high-level overview of what was done and why, as background only. Current truth comes from the code. Keep plan folders and RECORD.md; reshape OVERVIEW.md into a running what-and-why list that the session start shows trimmed to recent plans. Remove the area docs, /cairn:map, the close-time area check and area skip, the separate lasting-decision files, most of recall, and generated History.
**Why:** user: memory organized by code structure is too much and confusing; a record of what was done is history and cannot go stale; process belongs in cairn defaults or explicit user instructions, not memory
_2026-10-27 20:08_

### 18. What does each plan's overview entry look like?
**Decision:** A short paragraph, like a detailed changelog entry: what was built, why, and the big rocks a developer would care about (changed an API, added a model, reworked encryption), with a link to the record.
**Why:** user: think of it as a changelog with more detail; cover what, why and the big rocks a dev needs to know
_2026-10-27 20:10_

### 19. What does an agent get at session start?
**Decision:** The 5 most recent overview paragraphs in full plus a line pointing to docs/cairn/OVERVIEW.md. Discovery reads the full overview when new work touches older plans. Size stays fixed however many plans exist.
**Why:** user picked bounded context: recent work in full, older work on demand
_2026-10-27 20:11_

### 20. What happens to RECORD.md?
**Decision:** It stays as is: the full per-plan detail page a developer opens when the overview paragraph is not enough. The overview paragraph is written from it.
**Why:** user kept the record as the detail page
_2026-10-27 20:12_

### 21. What happens to existing area docs and decision files?
**Decision:** Delete docs/cairn/system/ and docs/cairn/decisions/ in this repo and backfill overview paragraphs for the past plans from their records. In other repos cairn stops reading those files and never deletes them; the README says they can be removed.
**Why:** user: clean this repo, never delete files people may have edited elsewhere
_2026-10-27 20:13_

### 22. Remove recall entirely
**Decision:** yes
**Why:** with no areas or decision files nothing path-specific remains; builders and reviewers stop getting it, discovery reads the overview, and the contradicts-a-decision review check goes
_2026-10-27 20:14_

### 23. Non-goal: roll-up of older plans
**Decision:** out of scope
**Why:** user: maybe summarize later; not in this plan
_2026-10-27 20:14_

### 24. Non-goal: announce as a breaking release
**Decision:** out of scope
**Why:** user did not pick it; the normal version bump applies
_2026-10-27 20:14_

### 25. When is the overview paragraph written?
**Decision:** At ship, by the recorder alongside RECORD.md, so the user reads it in the PR before merge.
**Why:** user: review it before it lands
_2026-10-27 20:15_

### 26. Trust boundaries
**Decision:** Model output: overview paragraphs are model-written and shown to every later session, so they are reviewed in the PR at ship. Deletes: only docs/cairn/system/ and docs/cairn/decisions/ in this repo; never in other repos. Public commands: /cairn:map, recall, area skip and the lasting-decision flags go away; removed commands and flags refuse with a plain message. Untrusted input, auth, personal data, money, migrations, new shell commands: not applicable.
**Why:** checked each boundary
_2026-10-27 20:15_

### 27. Earlier lasting flags on decisions 13, 14 and 16
**Decision:** Superseded by decision 17; they must not be published to docs/cairn/decisions/ when this plan closes.
**Why:** the reframe removed lasting-decision files; the installed cairn may still publish them at close
_2026-10-27 20:15_

### 28. What is the overview?
**Decision:** A developer-friendly, detailed changelog: one short paragraph per plan with what, why and the big rocks, newest first.
**Why:** user: treat the overview as a more developer friendly, detailed changelog
_2026-10-27 20:17_

### 29. Can the changelog be viewed in the pane?
**Decision:** Yes: a new Changelog tab beside Now, History and Records shows the changelog, nicely formatted, at any time; each entry links to its record. The Records tab stays.
**Why:** user: view it at any time, formatted nicely, in the mod as a tab with the other items
_2026-10-27 20:17_

### 30. Read-back
**Decision:** Outcome: Plan history plus a developer-friendly, detailed changelog. At ship the recorder writes RECORD.md and the plan's changelog entry (what, why, big rocks: API changes, new models, reworked encryption), both in the PR. OVERVIEW.md is the changelog, newest first. A new Changelog tab in the pane shows it formatted, any time, each entry linking to its record. Session start: last 5 entries + pointer; discovery reads the full changelog when work touches older plans. Area docs, /cairn:map, close-time doc check, area skip, lasting-decision files and recall removed. This repo's area/decision files deleted; past plans get backfilled entries. | User: Developers using cairn on their projects: humans skimming what was done, agents needing background. | Why now: Memory is small; fix the shape before plans pile up. | Success: Any plan's what/why in one paragraph, in repo or pane; agents start with a fixed-size summary; nothing claims 'how it works now', so nothing goes stale. | Constraint: No new stops for the user. | Out of scope: Roll-up (later); deleting files in other repos; breaking-release announcement; checking docs vs code. | Fresh-eyes challenge ran on the earlier goal; its points don't apply after the reframe.
**Why:** confirmed by the user
_2026-10-27 20:18_

### 31. Set aside: date tie-break order
**Decision:** Builder's call; keep today's records order (date, then slug).
**Why:** PRD builder check
_2026-10-27 20:20_

### 32. Set aside: exact refusal wording and exit code
**Decision:** Builder's call; refusals use the CLI's usual exit code 2.
**Why:** PRD builder check
_2026-10-27 20:20_

### 33. Set aside: fallback sentence splitting
**Decision:** Reuse the existing whyLine helper; a plan with no Why gets date and title only.
**Why:** PRD builder check
_2026-10-27 20:20_

### 34. Set aside: new version number
**Decision:** Builder's call under the normal bump (minor, 0.7.0).
**Why:** PRD builder check
_2026-10-27 20:20_

### 35. Set aside: index layout, pointer wording, pane emphasis and tab key
**Decision:** Builder's call, matching the existing pane and index style.
**Why:** PRD builder check
_2026-10-27 20:20_
