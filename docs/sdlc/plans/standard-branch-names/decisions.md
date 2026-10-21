# Decisions: Standard branch names

Append-only. Written by `cairn decide` as each decision is made.

### 1. How should plan branches be named?
**Decision:** By track: feature/<slug> for feature plans, fix/<slug> for fix plans. Only branches carrying cairn plan files count as plans; hand-made feature/ branches are ignored.
**Why:** Standard git workflow names, the simplest change; the plan track already says which one.
_2026-10-21 13:44_

### 2. What shape should task branches take?
**Decision:** task/<plan>/<task>
**Why:** Git forbids feature/x and feature/x/task together; a separate task/ folder keeps task branches out of the plan list.
_2026-10-21 13:44_

### 3. What happens to existing sdlc/ plans?
**Decision:** Keep them readable: cairn still finds sdlc/ and sdlc-task/ branches and finishes them under their old names. Only new plans get the new names. This plan ships as sdlc/standard-branch-names.
**Why:** Two old branches do not justify a rename migration.
_2026-10-21 13:44_

### 4. Who uses this, and what is out of scope?
**Decision:** Users: Jason, one developer, local repos. Non-goals: configurable prefixes, renaming existing branches, changing remote push or PR conventions beyond the branch name. Risky areas: none (no auth, money, data deletion or migrations; task branch deletion after merge is unchanged).
**Why:** Keep it the simplest move to standard names.
_2026-10-21 13:44_
