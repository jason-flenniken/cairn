---
description: Check whether the implementation is still aligned with the PRD and feature RDs in specs/, or drifting off course
argument-hint: "[all | FR-05 FR-08 … | changed]"
allowed-tools: Read, Grep, Glob, Agent, Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(ls:*), Bash(find:*), Bash(wc:*)
---

# /direction: is the build still on course?

You are auditing this codebase against its plan. **Read only. Do not edit any file**, in code or in `specs/`. Your job is to report, with evidence, where the implementation matches the plan, where it has drifted, and what to do about each drift.

Scope from arguments: `$ARGUMENTS`
- empty or `all` → every FR marked Shipped in the PRD, plus a scan for unplanned work
- one or more IDs like `FR-05 FR-08` → only those RDs, plus unplanned work touching their files
- `changed` → only what changed since the last commit (`git status`, `git diff HEAD`), checked against the RDs those files belong to

## 1. Load the plan

1. Read `specs/prd.md` in full. Extract:
   - every FR ID with its priority, status (Shipped / Planned) and target release (§11)
   - the **non goals** (§3.2): these are hard boundaries
   - non functional requirements (§7), the data model (§8) and the tech stack (§9)
2. Read each RD in `specs/features/` that is in scope (skip files starting with `_`, they are templates). For each, list its numbered requirements (FR-xx.y), acceptance criteria, data model, exact limits and messages, routes, and the files named in its header table.

## 2. Inventory the implementation

Build a picture of what actually exists before judging it:
- Routes: every page, API route and layout (use the feature map in `specs/CLAUDE.md` and the layout table in `CLAUDE.md` to find them)
- Mutations: every server action, API handler or endpoint that writes data, and what it writes
- Schema: every table, index and column in the schema file or migrations
- Integrations and env vars, outbound HTTP calls, new dependencies in the package manifest
- User facing copy for messages the RDs quote
- `README.md` and scripts for claims about the product

For `all` with many RDs, fan out: launch Explore agents in parallel (one per 2–3 RDs), each given the RD text and told to return a per requirement verdict with `file:line` evidence. Keep the unplanned work scan (step 3B) for yourself.

## 3. Compare

### A. Planned → built (coverage and fidelity)
For every in scope requirement, read the code that implements it and assign one verdict:

| Verdict | Meaning |
|---|---|
| ✅ Aligned | Behaviour matches the RD, including limits, messages and rules |
| 🟡 Partial | Implemented but a detail differs (a limit, a message, an edge case) |
| ❌ Missing | Required by a Shipped RD but not in the code |
| 🔀 Contradicted | Code does something the RD rules out |

Verify, don't assume: a function with the right name is not evidence. Check validation limits, authorisation checks, DB constraints and redirects against the RD's exact values.

### B. Built → planned (unplanned work)
Find code that no Shipped RD explains, and classify it:

| Class | Meaning |
|---|---|
| ⏩ Pulled forward | Implements a **Planned** FR ahead of its release in PRD §11 (name the FR and release) |
| ➕ Unplanned | No FR covers it at all |
| ⛔ Non goal breach | Moves the product toward something PRD §3.2 says it will not do |
| 🧹 Supporting | Infrastructure or refactor that serves existing FRs (not drift) |

### C. Cross cutting
- **NFRs (PRD §7)**: security (hashing, session handling, server side authorisation on every new action, open redirects), privacy (who can see customer data), accessibility basics, no horizontal scroll, data integrity constraints.
- **Data model drift**: tables or columns in code that PRD §8 doesn't list, or listed ones that changed.
- **Doc drift**: README, PRD and RDs disagreeing with each other or with the code.

## 4. Judge the direction

Overall verdict:
- **🟢 ON COURSE**: no ❌, 🔀 or ⛔; at most minor 🟡; any ⏩ or ➕ is small and documented.
- **🟡 DRIFTING**: some 🟡, ❌ or 🔀 in P1/P2 areas, or meaningful ⏩ / ➕ work that the specs don't mention yet.
- **🔴 OFF COURSE**: any ⛔ non goal breach, any ❌ or 🔀 on a P0 requirement, a security or privacy NFR violated, or unplanned work larger than the planned work in scope.

## 5. Report

Reply in this shape. Lead with the verdict. Every finding cites `path:line`.

```
## Direction: 🟢/🟡/🔴 <VERDICT>

<two or three sentences: what the plan says the product is, what the code is actually becoming, and the single biggest reason for the verdict>

### Scorecard
| FR | Title | ✅ | 🟡 | ❌ | 🔀 | Notes |
|----|-------|----|----|----|----|-------|

### Drift, most severe first
1. **<short title>** · <🔀/❌/⛔/⏩/➕/🟡> · <FR id or "none"> · `path:line`
   Plan says: <quote or paraphrase with RD reference>
   Code does: <what actually happens>
   Recommendation: **Fix code** | **Update spec** | **Decide** — <one line why>

### Unplanned work
| What | Where | Class | Closest FR | Suggested action |

### Doc drift
- <README / PRD / RD inconsistencies>

### Next steps
<3 to 5 ordered actions, e.g. "Write an RD for <unplanned feature>, or remove it", "Add server side check X">
```

Rules for recommendations:
- Recommend **Fix code** when the RD is clearly right (security, P0 behaviour, data integrity).
- Recommend **Update spec** when the code is a sensible evolution and the spec is just stale (e.g. a design change).
- Recommend **Decide** when it's a product call, especially any ⏩ or ⛔: name the trade off in one line and leave the choice to the user.
- Never call something aligned without having read the code for it. If you couldn't verify something, list it under a final "Not verified" heading instead of guessing.
