---
title: "cairn: Competitive Analysis and Best-Practice Review"
subtitle: "How cairn compares with Superpowers, Compound Engineering, Matt Pocock's skills, Spec Kit and OpenSpec, and how it holds up against current practice for unattended agents"
date: "2026-11-15"
revised: "2026-11-15, after review"
---

# cairn: Competitive Analysis and Best-Practice Review

*Prepared 2026-11-15. Every competitor figure (version, stars, release date) was read from GitHub on that date. Each project was cloned fresh and read file by file. Nothing was run. cairn was assessed against its code, not just its README.*

## Contents

1. Summary
2. What cairn is and what it solves
3. The landscape at a glance
4. How cairn differs from each project
5. What they have that cairn doesn't
6. How cairn holds up against current best practice for unattended agents
7. Recommendations, ranked
8. Sources
9. Method and caveats
10. Decisions and roadmap

---

## 1. Summary

**What cairn is.** cairn is a Claude Code plugin, also runnable in Codex, that takes a feature from idea to merged PR in the same fixed stages every time: Discover, PRD, Plan, Build, Check, Review, Ship, Learn. It differs from every project in this comparison in one way. A CLI, not the model, owns the plan's state: the stage, tasks, approvals, test results and locked proofs. The CLI refuses any move whose evidence is missing. A Claude Code mod adds a live pane, menu approvals that the model cannot forge, and guards against the model approving its own work.

**How it compares.** The five projects fall into three groups:

- **Prose-skill methodologies:** Superpowers and Compound Engineering. Both are large and fast-moving, and both have adopted more of cairn's ideas than cairn's README credits (see section 4).
- **A composable skill collection:** Matt Pocock's skills, which deliberately refuse to "own the process".
- **Spec-driven toolkits:** Spec Kit and OpenSpec. Both are portable across 40 or more agents. Their CLIs manage files and validate specs, but they don't run or police the build.

None of the five stops the model approving its own work. None locks acceptance checks against tampering. None tracks cost or shows running agents.

**What cairn lacks.** The biggest gaps are:

1. Portability. Peers support 14 to 43 hosts; cairn supports two.
2. Behavioral evals of its own procedures. Compound Engineering and Superpowers both have them, and `claude plugin eval` now exists for exactly this.
3. A retrievable store of lessons that planning and review actually consult. Compound Engineering's `docs/solutions/` does this.
4. Living specs that record what the system does now. OpenSpec does this, and cairn chose not to; that tradeoff is discussed below.
5. Deeper review machinery: a separate pass that verifies findings before they're reported, and cross-model reviewers.
6. Handling after the PR opens: watching CI and answering review comments.

**Against current best practice.** cairn is strong on most of what Anthropic, OpenAI, Cursor, Cognition, Stripe and Spotify now publish about unattended agents:

- state outside the context window;
- "done" agreed before the build as runnable checks;
- separate, skeptical evaluators;
- bounded retries enforced in code;
- disjoint-scope parallel writers;
- ceremony scaled to risk;
- oversight through visibility rather than per-action prompts.

Its weak spots are what lets an unattended run be trusted *without you there*:

- no guidance or defaults for sandboxing and permissions;
- no spend or time caps (cost is tracked, not limited);
- no headless or cloud path;
- no eval suite showing that each piece of ceremony earns its cost on today's models.

Anthropic's own recent writing (Mar–Nov 2026) puts the most weight on that last point.

**Decisions taken.** After review, cairn will build plan budgets first, then an eval suite that measures each piece of ceremony, then an on-demand system overview generated from plan history and a quick scan for gaps. The README competitor claims and a guide to unattended setup are direct edits. Section 10 has the roadmap and the reasons.

---

## 2. What cairn is and what it solves

cairn (v0.22.0, MIT) is a Claude Code plugin and marketplace. It runs a feature through eight stages:

```
Discover → PRD → Plan → Build → Check → Review → Ship → Learn
```

Agents do the work, and the human makes three calls: approve the PRD, approve the plan, approve the ship.

### The problems it was built for

The README names six failure modes of prose-driven workflow plugins:

1. Long plans drift.
2. Steps get skipped.
3. There's no single view of where a plan stands.
4. Every run pays for full ceremony whether or not the change needs it.
5. The session that shaped a plan is the one judging it, so a wrong direction goes unchallenged.
6. "Done" is whatever the builder says, so the user gets pulled back mid-build.

### How it solves them

**A CLI owns the state.** A zero-dependency TypeScript CLI (about 8,300 lines, about 540 tests) is the only writer of each plan's `state.json`. Every stage move is validated, and a missing approval, PRD section, passing test run or green proof produces a refusal that names the exact fix. Overrides are possible but logged with a reason.

**You choose the effort.** There are three levels: MVP, Standard and Polished. At Standard, per-task review, thorough tests and a security review go only to *risky* tasks (auth, money, data deletion, migrations, public APIs) and to complex ones. One branch review covers the rest. Deferred quality work becomes "recommended follow-ups", which come back when a later plan touches the same files.

**Approvals the model can't forge.** The mod records an approval only when the human picks it from a menu or types it. Behind that sits a one-time secret per approval, checked against a hash on disk. Guards block the model from running `cairn approve`, setting the approver variable, or editing plan state. The ship approval covers one commit, and `cairn merge-check` refuses a merge if code changed after approval.

**Proofs.** These are optional and recommended at Standard and Polished. Each requirement becomes a runnable check: a test, a command, or a browser flow with screenshots. The user sees every check fail before the build starts. Approving the plan locks them by hash, and from then on they are add-only: a merge that edits a locked proof file is refused. Check and Ship both require every proof green on the final code. UI screenshots are judged by a fresh `visual-checker` agent against an agreed description or mockup.

**Fresh eyes.** Two reviewers start without the conversation:

- a *challenger* in Discover, which sees the goal and the facts but not cairn's proposed approach;
- a *builder check* on the PRD, which sees only `prd.md`.

Reviewers judge the diff, not the builder's account of it.

**Parallel, isolated work.** Each plan gets its own branch and worktree, and so does each task. Tasks whose file scopes don't overlap run in parallel, up to 3 by default. A post-edit hook logs edits outside a task's declared scope.

**A build that runs without asking.** After plan approval:

- easy-to-reverse questions are decided and logged as `Assumed:` decisions, listed again at ship;
- red tests, red proofs and review findings go straight to a fix;
- a task still stuck after two fix attempts (a limit the CLI enforces) is set aside while other work continues;
- the user gets one consolidated question, not one per problem.

**Observability and cost.** A live pane shows a card per running agent with model, time, tokens and estimated cost, plus a plan timeline and records. The bottom bar shows plan cost and the 5-hour and weekly usage limits, and per-plan usage is saved at close.

**A lean main session.** Briefs and reports live on disk, and writer agents own `prd.md` and `plan.md`, so the orchestrating session carries paths, not content.

**Memory.** Memory is plan records plus a generated changelog. The design keeps what was done and why, not living docs about how code works now, so nothing it stores can go stale. Review rules learned at ship are appended to `REVIEW.md`, but only when the user ticks them.

**Extras:**

- a bug-fix lane that requires a failing repro and traces the bug to the plan that introduced it;
- deep Linear integration (pull epics in, move tickets per task, a board, writing specced tickets);
- stacked plans;
- Codex support with terminal approvals and a PreToolUse guard.

---

## 3. The landscape at a glance

| | **cairn** | **Superpowers** | **Compound Engineering** | **Matt Pocock's skills** | **Spec Kit** | **OpenSpec** |
|---|---|---|---|---|---|---|
| Kind | Lifecycle with CLI-owned state | Prose-skill methodology | Prose-skill methodology | Composable skill collection | Spec-driven toolkit and CLI | Spec-driven toolkit and CLI |
| Version / last release | 0.22.0 | 7.0.2 (2026-11-03) | 3.38.1 (2026-11-12) | 1.3.2 (2026-10-29) | 1.4.0 (2026-11-10) | 2.0.0 (2026-11-11) |
| GitHub stars | 1 (public since 2026-10-21) | ~318k | ~26k | ~325k | ~150k | ~75k |
| Contributors | 1 | ~37 | ~110 | effectively 1 | ~340 | ~150 |
| What enforces the workflow | CLI refusals, hooks, mod guards | Prose; one SessionStart hook; helper scripts | Prose; contract tests on skill text | Prose | CLI scaffolds and checks prerequisites; phases are prose; optional YAML workflow engine | CLI validates spec format and archive merges; phases are prose |
| Human approval the model can't forge | **Yes** | No | No | No | No | No |
| "Done" checked by | Locked runnable proofs, tests, acceptance and visual checkers | TDD, fresh test run, task-done script | Chosen evidence, host-side verification, browser tests | TDD at agreed seams, review | Requirement checklists, consistency analysis, converge loop | Ticked tasks, optional verify skill |
| Independent reviewers | Task, security, branch, visual; fresh-eyes before PRD | Per-task reviewer, final reviewer, builder check | 15 conditional personas plus a validator pass | Two-axis fresh reviewers | None | None |
| Parallel tasks in worktrees | Yes, scope-checked | No (sequential tasks) | Yes (waves of 3 to 5) | Yes (`implement-spec`) | `[P]` hints only | No |
| Cost tracking | **Per agent and per plan, plus usage limits** | No | No | No | No | No |
| Hosts | Claude Code, Codex | ~16 | 14 | 5+ (via `npx skills`) | ~43 | ~40 |
| Tracker | Linear (deep) | None | GitHub, Linear for deferrals, Slack intake | GitHub, GitLab, local | GitHub issues (extension) | None |
| Living specs | No (records and changelog by design) | No | No (`docs/solutions/` learnings) | Glossary and ADRs | Optional pattern | **Yes (core model)** |
| Behavioral evals of itself | No | Yes (separate repo) | Yes (eval harness, blind judge) | No | No (large unit suite) | No (large unit suite) |

---

## 4. How cairn differs from each project

### A correction to cairn's own README first

The README says Superpowers and Compound Engineering "describe their stages in prose that the model may or may not follow, and they let the session that shaped a plan also judge it." The first half is still accurate: neither has hooks that enforce stages, nor a CLI-owned state file. The second half is now **out of date**:

- **Superpowers** runs a fresh "builder check" subagent on the design doc that returns questions to sort into answered, minor and the user's. This is almost the same idea as cairn's PRD builder check. It also has a read-only per-task reviewer that sees a diff package, not the session.
- **Compound Engineering** reviews with up to 15 fresh-context personas plus a separate validator, and reviews plans with `ce-doc-review`.

The README should be revised. The difference that holds up is **mechanical enforcement and approvals the model can't forge**. Independent judging alone is no longer a difference.

There is also visible convergence, partly because cairn credits all three of these projects as sources:

- Superpowers now writes briefs and reports to disk, as cairn has done since 0.16.
- Superpowers logs "rulings, not stalls" during execution, the same idea as cairn's `Assumed:` decisions.
- Compound Engineering verifies workers' claims on the host side and tiers worker models.

### Superpowers (obra/superpowers)

**What it is.** Superpowers is the most popular methodology in this space: 16 skills covering brainstorm, worktree, plan, subagent-driven development, TDD, review and finish, with about 318k stars. Its bootstrap hook re-injects "you MUST use skills" on startup, clear and compact. Rules are hardened with prose gates ("Iron Law", `<HARD-GATE>`) and red-flag tables. The skills themselves are written test-first against adversarial pressure scenarios.

**How cairn differs:**

| | cairn | Superpowers |
|---|---|---|
| State | `state.json`, written only by the CLI, refusals on bad moves | A git-ignored progress ledger, deleted after a clean final review |
| Approvals | Proven by the mod | Conversational |
| Task execution | Parallel, in separate worktrees | Sequential, one fresh implementer per task |
| Fix loop | Two attempts, then the task is set aside | Up to five rounds with a model bump and a circuit breaker |
| Memory across runs | Records, changelog, follow-ups, review rules | None |
| UI and cost tracking | Live pane, per-agent and per-plan cost | None |
| Hosts | 2 | ~16 |
| Self-testing | Doc-wording tests | Skills tested as code: baseline without the skill, then with it |

**Bottom line.** Superpowers wins on reach, polish of individual skills, and testing the skills themselves. cairn wins on enforcement, parallelism, visibility, approvals and memory.

### Compound Engineering (EveryInc)

**What it is.** Compound Engineering has 38 skills around brainstorm → plan → work → simplify → review → compound. An `lfg` autopilot runs the whole chain to an open PR and babysits CI. Its namesake idea is that every run should make the next one easier. `ce-compound` writes one durable lesson per run to `docs/solutions/`, but only if a future engineer would plausibly repeat the mistake without it. It prefers a test or lint rule over prose. A learnings-researcher pulls those lessons into planning and review.

**How cairn differs:**

| | cairn | Compound Engineering |
|---|---|---|
| Enforcement | Stage gates in code | Contracts in prose; tests check only that the markdown contains them |
| Approvals | Can't be forged | Conversational |
| Proofs | Locked and add-only | None (it does test browsers and dogfood) |
| Review | Narrower: task, security and branch reviewers | Broader: 15 conditional personas, P0–P3 severity, confidence anchors, a must-quote-the-line rule, a validator pass, cross-model reviewers |
| Learning | Records and changelog; only the review rules learned feed back | Retrieved during planning and review |
| After the PR opens | Merges only what was approved | Babysits CI, resolves PR feedback, tests changed routes in a browser, dogfoods exploratorily, runs a simplify step |
| Hosts | 2 | 14 |
| Cost tracking | Per agent and per plan | None |

**Bottom line.** Compound Engineering is the closest peer in ambition, and ahead on review depth, learning retrieval and handling after the PR opens. cairn is ahead on the trust layer (state, approvals, proofs) and on observability.

### Matt Pocock's skills

**What it is.** About 27 small, sharp skills that explicitly reject owning the process ("Approaches like GSD, BMAD, and Spec-Kit … take away your control"). A router skill documents a suggested flow:

```
grill-with-docs → to-spec → to-tickets → implement / implement-spec → code-review → retro
```

Specs and tickets live in the user's tracker: GitHub, GitLab or local files. `implement-spec` runs a fresh implementer per ticket in its own worktree, merging onto an integration branch as the frontier of unblocked tickets advances.

**Distinctive ideas:**

- a shared `GLOSSARY.md` with "avoid" lists, plus ADRs that every skill reads;
- tracer-bullet vertical slices;
- pre-agreed test seams for TDD;
- "wayfinder" decision maps for work too foggy to spec;
- a "smart zone" context budget with an explicit decision tree for when to continue, clear, hand off, use a subagent or compact.

**How cairn differs.** cairn is a system and this is a toolkit, so neither is better in general. What separates them:

- cairn's interview borrows the grilling style.
- cairn enforces the flow; this collection trusts the engineer to drive it.
- It has no state, no approvals, no proofs, no cost tracking and no evals of its own skills.
- It runs on more hosts and supports more trackers.

For unattended work, Matt points to a separate project, Sandcastle, or plain loops: "a deterministic loop … is faster, cheaper, and more reliable."

**Bottom line.** The glossary/ADR practice and the wayfinder are the ideas most worth borrowing.

### Spec Kit (GitHub)

**What it is.** Spec Kit is a Python `specify` CLI that installs markdown commands into about 43 agents. The commands are constitution, specify, clarify, plan, checklist, tasks, analyze, implement, and the new `converge`. Converge appends unmet work to `tasks.md` and loops with implement until it reports "Converged". Spec Kit has grown into a general toolkit for agent workflows, with extensions, presets, bundles, catalogs and a YAML workflow engine that has run IDs, gates and resume.

**How cairn differs.** Spec Kit's CLI is an installer and file manager. The phases themselves run on prose, and "gates" are instructions to the model. Its notion of "done" is mostly about requirement *quality*: checklists are "unit tests for English", and `analyze` checks consistency across artifacts. It has:

- no test runner;
- no independent reviewers;
- no real parallel scheduling (`[P]` markers are hints);
- no worktrees;
- no cost tracking;
- workflow gates that anyone, the agent included, can approve with a CLI flag.

It is far ahead on portability and on extensibility through swappable process layers. The most-cited critique comes from Birgitta Böckeler on martinfowler.com (Oct 2025): it is heavy for small changes, its many markdown files are harder to review than code, and agents still ignore the spec. Version 1.x has partly answered this with a lean preset and living-spec guidance. cairn's levels and fix lane address the same critique.

### OpenSpec (Fission-AI)

**What it is.** OpenSpec has the cleanest **living specs** model in this group:

- `openspec/specs/` is the source of truth for what the system does now;
- each change in `openspec/changes/<name>/` carries delta specs (ADDED, MODIFIED, REMOVED, RENAMED);
- archiving merges the deltas into the living specs.

The archive merge is carefully hardened. It refuses to drop scenarios silently, and it fingerprints files to catch concurrent edits. The flow itself is a forkable artifact graph (`schema.yaml`). Version 2.0 (2026-11-11) went skills-only, with one shared `.agents/skills/` folder linked into about 40 tools.

**How cairn differs.** OpenSpec is deliberately "fluid not rigid". It has:

- no phase gates ("no phase gates" is in its docs);
- no approvals beyond conventions;
- no subagents, worktrees, test execution, reviewers or pause machinery;
- "done" meaning ticked checkboxes plus an optional verify skill.

It is light, brownfield-first and portable. cairn is heavier and enforced.

**The real philosophical split is memory.** OpenSpec keeps a current-state spec that every change must update. cairn's 0.7.0 decision went the other way: keep history (records and a changelog), and never keep docs about how the code works now, because they go stale unchecked. Both are defensible:

- OpenSpec avoids staleness by making the spec update part of every change, and its CLI validates the structure.
- cairn avoids it by not keeping current-state docs at all.

What cairn gives up is a reviewable, requirement-level answer to "what does this system do today?"

---

## 5. What they have that cairn doesn't

Ordered by likely value to cairn. Each item names where it lives, so it can be studied. "Worth adopting?" is a judgment call.

### High value

**1. Behavioral evals of the plugin itself.**

- *Compound Engineering:* `tests/skill-eval-cell/` extracts a skill at a git ref and runs the same prompt through the `claude`, `codex` and `grok` CLIs, with `git push` intercepted, read-only fixtures and a blind LLM judge. Its `ce-retune` skill re-tunes the skills for a new model, measures first, and refuses to proceed without a benchmark harness.
- *Superpowers:* behavioral evals live in a separate repo (prime-radiant-inc/superpowers-evals) driving real tmux sessions. Skills are written TDD-style against pressure scenarios (`skills/writing-skills/`).
- *cairn:* about 540 CLI tests and tests that assert procedure wording. Nothing checks that an agent *following* a procedure behaves correctly, or that a piece of ceremony beats leaving it out.
- *Worth adopting?* **Yes. This is the top recommendation.** Anthropic shipped `claude plugin eval` (Sep 2026) for this: cases with graders, three runs each, a comparison against no plugin, and gating in CI with a cost cap.
- *What the tool can and can't do (checked against its docs on 2026-11-15):*
  - **It has no command or test graders.** Graders are `regex`, `file_exists`, `tool_used`, `tool_order` and an LLM judge. cairn can work around this because the CLI writes `state.json` itself, so regex graders on it can check the stage, whether proofs are green, fix rounds used and set-aside tasks.
  - **Ablation turns the whole plugin on or off.** No flag turns off one skill, agent or hook. Only `EVAL_*` environment variables reach the run, so cairn needs an `EVAL_CAIRN_SKIP` switch for each piece of ceremony and a script that runs the suite once per variant and compares the results.
  - **Runs are non-interactive.** There are no menus and no simulated approval. Cases therefore start from plan state that a scaffold has already approved, using the same helper as the CLI tests, and stop at the next approval. No approval bypass exists while the agent runs.
  - **`--max-cost-usd` caps the eval suite, not a plan.** It does not replace plan budgets (row 8).

**2. A store of lessons that gets used.**

- *Compound Engineering:* `ce-compound` writes typed lessons to `docs/solutions/` only when they pass a "would someone repeat this?" test. It prefers turning a lesson into a test or lint rule. A learnings-researcher pulls them into `ce-plan`, `ce-ideate` and `ce-code-review`, and a refresh mode audits old lessons against current code.
- *Matt Pocock's skills:* `/retro` turns session lessons into environment changes: mechanical misses become checks, judgment calls become standards.
- *cairn:* keeps records and a changelog, and learns review rules into `REVIEW.md`. Discover reads the changelog, but the lessons ("we tried X, it failed because Y") are buried in records, and no planning step looks them up.
- *Worth adopting?* **Yes, in a form that fits cairn's no-stale-docs rule.** Lessons tied to a plan record and a commit, retrieved by file overlap the way follow-ups already are, and preferring a test or lint rule.
- *Caveat:* lessons taken only from records miss work built outside a plan, which in this repo is most of it. Deferred until the eval suite can show that it pays off.

**3. Portability beyond Claude Code and Codex.**

- *Peers:* Superpowers ships manifests for about 16 hosts. Compound Engineering supports 14. Spec Kit renders one prompt source into about 43 agents. OpenSpec 2.0 links one `.agents/skills/` folder into about 40 tools.
- *cairn:* runs in two hosts, and the mod (pane, approval proof, guards) exists only in Claude Code.
- *Worth adopting?* **Partly.** The CLI and procedures could reach more hosts, as Codex already does, but the trust layer depends on hooks. One option: aim at hosts with PreToolUse-style hooks (Cursor, Gemini CLI, Copilot CLI) and say plainly that elsewhere approvals fall back to the terminal.

**4. Checking review findings before they're reported, and broader reviewers.**

- *Compound Engineering:*
  - findings carry a confidence anchor (0, 25, 50, 75 or 100);
  - high-confidence findings must quote the exact line;
  - a fresh validator subagent re-checks findings in batches;
  - reviewers are picked from 15 conditional personas, among them data-migration, API contract, reliability, frontend races and adversarial;
  - an optional reviewer from another vendor's model.
- *Anthropic's Code Review:* the same step after finding bugs, and under 1% of findings were marked incorrect.
- *cairn:* requires a triggering path and `path:line` for every finding, but has no separate verification pass, and its reviewers are fixed roles.
- *Worth adopting?* **The verification pass, yes.** It is cheap, and it cuts false fixes during autonomous builds. Conditional reviewers are cairn-shaped too: a migration reviewer for migration tasks.

**5. Handling the PR after it opens.**

- *Compound Engineering:* `ce-babysit-pr` watches CI until it's decided, and `ce-resolve-pr-feedback` triages review comments.
- *cairn:* opens the PR and merges exactly the approved commit, but doesn't watch CI or answer reviewers' comments.
- *Worth adopting?* **Yes**, with a bounded number of CI rounds, as Stripe does with two.

### Medium value

**6. Living specs.**

- *OpenSpec:* current-truth specs and delta merging.
- *Spec Kit:* documents flow-back, flow-forward and living-spec options.
- *Worth adopting?* **Revisit, don't copy.** cairn deliberately rejected living docs about how the code works.
- *Chosen instead (2026-11-15):* an on-demand `/cairn:system` overview.
  - It writes a generated `docs/cairn/SYSTEM.md`, stamped with the commit it was built from.
  - It is organized by capability and flow, not by folder, with diagrams where a real flow exists and paths into the code for drilling deeper.
  - Its backbone is the plan changelogs, RECORDs and decisions, which explain why things were built. They are checked against a quick scan of the README, the CLI command list and the top-level modules for anything big they miss.
  - Code is opened only for a gap the scan finds, and later runs read only what changed since the stamp.
- *Why records alone fall short:* only 2 of the roughly 20 versions shipped since 0.7 went through a cairn plan. The rest were built directly, so a roll-up of records would leave out proofs, the lean Standard level, usage tracking, Codex and `/cairn:spec`.
- *Replaced:* the requirement register proposed earlier.

**7. Shared vocabulary and decision records.**

- *Matt Pocock's skills:* `GLOSSARY.md` with avoid-lists plus ADRs, read by every skill. Its README calls this "the single coolest technique in this repo".
- *Compound Engineering:* `CONCEPTS.md`.
- *cairn:* has `decisions.md` per plan, but no project-wide language file.
- *Worth adopting?* **Probably**, as an optional project file that Discover and the PRD writer read and update.

**8. A simplify step and exploratory QA.**

- *Compound Engineering:*
  - `ce-simplify-code` runs before review;
  - `ce-test-browser` maps changed files to routes and tests them;
  - `ce-dogfood` does hands-off exploratory QA that fixes small breakages.
- *cairn:* UI proofs cover what was agreed, not what the user will stumble on.
- *Worth adopting?* A diff-scoped browser pass at Check is a natural extension of `visual-checker`. The `start` and `seed` config keys are already recorded but unused.

**9. A pluggable workflow.**

- *Spec Kit:* extensions, presets, bundles, workflows, private catalogs.
- *OpenSpec:* `openspec schema fork`.
- *cairn:* the lifecycle is fixed; only the level varies.
- *Worth adopting?* **Low priority.** A fixed lifecycle is part of cairn's reliability story. Configurable reviewer sets or Check steps would cover most needs.

**10. Working without a spec.**

- *Matt Pocock's wayfinder:* a long-lived map of decision tickets, settled one per session, for efforts too foggy to spec.
- *OpenSpec explore* and *Compound Engineering's ideate and brainstorm:* thinking partners before committing.
- *cairn:* has `/cairn:product` and Discover, but nothing for "we don't know enough to plan yet" across several sessions.
- *Worth adopting?* Possibly, as a Linear-backed map that `/cairn:spec` draws from.

**11. More trackers.**

- *Matt Pocock's skills:* GitHub, GitLab and local.
- *Spec Kit:* tasks to GitHub issues.
- *Compound Engineering:* intake from Slack and GitHub issues (`ce-sweep`).
- *cairn:* Linear only.
- *Worth adopting?* GitHub Issues would widen reach most cheaply.

### Lower value or niche

**12. Self-diagnosis.** Superpowers' `diagnosing-superpowers` reads the session transcript and builds a redacted bug-report bundle. That's useful for an open-source plugin collecting bug reports.

**13. Planning across repos.** OpenSpec "Stores" (beta) plan one change across several repos.

**14. Tests that check documentation claims.** OpenSpec's `*-docs-claims.test.ts` binds documentation statements to behavior. cairn's doc tests check procedure wording, which is a cousin of this but not the same.

**15. Reach and community.** Every peer has tens to hundreds of contributors and tens of thousands or more stars. cairn has one maintainer and was published four weeks ago. That matters for trust and adoption, not for capability.

### What cairn has that none of them do

To be fair to cairn's position:

- approvals the model can't forge, and guards on state;
- **locked, add-only, hashed proofs** that must be seen failing first;
- refusals from a CLI on every stage move;
- fix attempts capped in code;
- per-agent and per-plan cost, plus the 5-hour and weekly usage limits, in a live pane;
- merge-time proof that the merged commit is the approved one;
- a bug lane that traces bugs back to their origin and proposes a review rule;
- a fresh-eyes challenger *before* the PRD;
- one plan per session;
- deep Linear integration with stacked plans.

---

## 6. How cairn holds up against current best practice for unattended agents

The practices below come from two research sweeps on 2026-11-15:

- **Anthropic:** engineering blog, claude.com blog, Claude Code docs and alignment research, with emphasis on Mar–Nov 2026.
- **Others:** OpenAI, Cursor, Cognition, Stripe, Spotify, GitHub, Factory, METR, martinfowler.com, Addy Osmani and arXiv.

Ratings: **Strong** means the practice is met in code. **Partial** means it's met in part, in prose, or only at some levels. **Gap** means it's missing.

### 6.1 Scorecard

| # | Practice (source) | cairn | Evidence and comment |
|---|---|---|---|
| 1 | **State outside the context window; the loop can restart.** (Anthropic, *Effective harnesses*, Nov 2025; *Managed Agents*, Apr 2026; OpenAI, *Harness engineering*, Feb 2026) | **Strong** | `state.json` is CLI-owned. There's `handoff.md`, pause and resume, and a SessionStart hook on startup, resume, clear and compact. Anthropic's harness kept a JSON feature list where agents could flip only a `passes` field, which is the same idea cairn implements more rigorously. |
| 2 | **Agree "done" before the build, as runnable pass/fail checks.** (Anthropic, *Harness design*, Mar 2026: "sprint contracts"; OpenAI Codex `/goal`; Osmani, Apr 2026) | **Strong** | Proofs must fail before the build, are locked at plan approval, and must be green at Check and Ship. This is the closest match to Anthropic's sprint contracts of anything in this comparison. It is optional, though, and off by default at MVP. |
| 3 | **A separate, skeptical evaluator. Claude is "a poor QA agent out of the box" when grading its own work.** (Anthropic, Mar 2026; Cognition, Apr 2026; Osmani) | **Strong** | Task reviewers see the diff, not the builder's story. `visual-checker` never saw the build. Acceptance and direction checkers read the PRD against the code. Fresh eyes run before the PRD. |
| 4 | **Verify end to end the way a user would (browser, screenshots), and make the app legible to the agent.** (Anthropic, Nov 2025 and Mar 2026; OpenAI, Feb 2026; Cursor, Feb 2026) | **Partial** | UI proofs drive a browser and save screenshots that are judged. There's no per-worktree app boot or log access for agents, and `start` and `seed` are "recorded … the lean defaults don't use them yet". There's no exploratory pass beyond the agreed proofs. |
| 5 | **The agent that writes code must not be able to write the grader or the approval state.** (Anthropic, *Training a misaligned reward seeker*, Aug 2026; *Eval awareness in BrowseComp*, Mar 2026; METR, Aug 2026; *Effective harnesses*: forbid editing tests) | **Strong / Partial** | Proofs are hash-locked and add-only, the CLI runs them itself so results aren't agent-written logs, and guards block writes to state and approval files. The README says plainly that the guards match command spellings and aren't a security boundary. A determined agent with shell access to `.git/cairn/` could forge a proof. |
| 6 | **Keep some checks hidden from the implementer. Visible tests saturate, and held-out ones expose the gap.** (SpecBench, arXiv 2605.21384, May–Sep 2026; *The Verification Horizon*, arXiv 2606.26300) | **Gap** | Builders see and run every proof (`cairn prove --here`), which is good for convergence but invites fitting to the check. The proof-writer is told to rule out stubs and hard-coded values. No checks are held back for Check only. |
| 7 | **Enforce in code what must always or never happen; keep prose for preferences.** (Claude Code best practices: "If you keep adding emphasis, make it a hook"; Stripe Minions, Feb 2026: deterministic steps between agent steps) | **Strong** | Stage transitions, approvals, scope logging, fix-round caps, proof locks and merge-check are all code. The Stripe pattern of plain code between agent steps is what the cairn CLI does. |
| 8 | **Bounded retries, circuit breakers and budgets.** (Stripe: at most 2 CI rounds; Osmani; Claude Code: `--max-turns`, `--max-budget-usd`) | **Partial** | Fix attempts are capped at 2 in code, followed by the set-aside path. There's **no spend, token or wall-clock cap**: cost is tracked and shown, never enforced. A runaway plan is visible but not stopped. |
| 9 | **The hard boundary belongs in the environment: OS sandbox, egress allowlist, no credentials inside.** (Anthropic, *Beyond permission prompts*, Oct 2025; *How we contain Claude*, May 2026; Stripe devboxes, Feb 2026) | **Gap** | cairn neither documents nor configures sandboxing, network policy or permission modes for a build. It inherits whatever the user's session allows. Anthropic reports auto mode still misses about 17% of overeager actions, so "use auto mode" alone isn't the answer. |
| 10 | **Five questions before you leave a run: what done is, how it checks itself, what it may touch, what stops it, who signs off.** (Claude Code best practices, "Let Claude run without you") | **Partial** | Done (proofs), checking (tests and checkers), sign-off (the ship approval) and scope (task worktrees and file scopes, logged rather than blocked) are covered. *What stops it* (budget or time caps) is missing, and *what it may touch* is enforced only by convention. |
| 11 | **Background, cloud or headless runs; work returned as a PR.** (Claude Code routines, Apr 2026; Cursor cloud agents, >30% of merged PRs, Feb 2026; GitHub Agent HQ; Spotify) | **Gap** | The build runs on its own, but inside an interactive session the user keeps open. There's no documented `claude -p` or cloud-session path, and no routine that picks up an approved plan. Approvals rightly need a human, but the stretch between plan approval and ship approval is exactly what could run in the cloud. |
| 12 | **Eval the harness itself: grade the end state, run several trials, compare against no harness, ablate when models change.** (Anthropic, *Demystifying evals*, Jan 2026; *April 23 postmortem*; `claude plugin eval`, Sep 2026; *Building strong safety evaluations*, Nov 2026) | **Gap** | There's no behavioral eval. With 16 agent roles and three levels, cairn can't currently show which ceremony earns its cost on today's models. |
| 13 | **Remove harness parts as models improve. "Every component encodes an assumption about what the model can't do."** (Anthropic, *Harness design*, Mar 2026) | **Partial** | The levels and the lean Standard of 0.20 are the right instinct: review where the risk is. Without evals (row 12), removal is judgment, not measurement. |
| 14 | **Split subagents by context, not by role; fold them back when specialists chain on each other.** (Anthropic, *When to fold subagents into your main agent loop*, Oct 22 2026; Cognition, Apr 2026: keep writes single-threaded) | **Partial** | cairn already cites this post for fresh eyes, and those splits are context-based and justified. Some pairs chain, though: prd-writer with prd-checker, plan-writer with plan-reviewer, and the separate recorder. The Oct 2026 post says to eval such chains and fold any that are a "telephone game". Parallel *writers* are limited to disjoint file scopes, which matches Cognition's and Cursor's findings. |
| 15 | **Parallel writers need disjoint scopes and an integration check at the end, not global locks.** (Cursor, *Scaling agents*, Jan 2026; Anthropic, *Redesigning source control*, Oct 2026) | **Strong** | Ready tasks are computed from non-overlapping scopes, each task runs in its own worktree, edits outside scope are logged, and the full suite runs at each phase end. |
| 16 | **Treat context as a budget: retrieve just in time, keep notes on disk, have subagents return short summaries.** (Anthropic, *Effective context engineering*, Sep 2025) | **Strong** | Since 0.16, briefs and reports live on disk, the main session reads only the last lines of each agent's reply, and documents are written by writer agents. |
| 17 | **Scale ceremony to the size of the task.** (Böckeler, martinfowler.com, Oct 2025; Anthropic, *Building effective agents*) | **Strong** | Three levels, a fix lane, risk-tiered review, and fresh eyes that can be skipped when there's one obvious approach. This answers the main criticism of spec-driven tools. |
| 18 | **Design for oversight (visibility plus easy redirect), not per-action approval; agents stop themselves when stuck.** (Anthropic, *Measuring agent autonomy*, Feb 2026) | **Strong** | The pane, Pause and Stop-now, set-aside with a single consolidated question, and `Assumed:` decisions listed at ship. |
| 19 | **Observability and cost: log everything, know cost per phase.** (Cursor; Anthropic, multi-agent research; *Harness design* cost data) | **Strong** | A per-plan event log (History), per-agent tokens and cost, plan cost, `usage.json`, `USAGE.md`. Unique in this comparison. |
| 20 | **A judge that checks scope against the original intent.** (Spotify Honk part 3, Dec 2025: about 25% of sessions vetoed for unrequested changes) | **Partial** | Edits outside scope are logged. The direction checker runs on demand, or automatically at Polished. Reviewers check against the task and its requirements. Nothing compares the diff with the PRD at Standard. |
| 21 | **Check review findings before reporting them; scale review depth to the diff; agents never approve PRs.** (Anthropic, *Code Review*, Mar 2026) | **Partial** | Evidence is required and depth is risk-tiered. The ship approval is human-only, enforced. There's no separate pass that verifies findings. |
| 22 | **Memory: keep what can't be re-read, record how you know it, one writer per file.** (Anthropic, *The components of agent memory*, Nov 6 2026) | **Strong / Partial** | Records hold decisions and evidence rather than mirrored state, and the CLI is the only writer of state. These match the post closely. The weak spot is retrieving lessons when planning (see section 5, item 2). |
| 23 | **Agent readiness of the environment: fast feedback, documented environment, a working dev setup.** (Factory, Jan 2026; OpenAI, Feb 2026) | **Partial** | `/cairn:new` detects and confirms the test and build commands, and `setup` runs in every worktree. There's no readiness check, for example whether tests are fast, deterministic and runnable inside a worktree. Matt Pocock's notes flag git-ignored fixtures that silently skip tests in worktrees. |
| 24 | **Portable formats: AGENTS.md and Agent Skills.** (Agentic AI Foundation; OpenAI) | **Partial** | Skills use the SKILL.md format, and Codex works. The mod is Claude Code-only, which caps portability. |

### 6.2 Reading the scorecard

**Where cairn is ahead of the field.** On the *integrity* of an autonomous build, cairn is ahead of all five peers and closely matches what Anthropic and OpenAI describe doing internally:

- plan state the model can't rewrite;
- a definition of done the model can't weaken;
- approvals it can't forge;
- retries bounded in code;
- evaluators that don't share the builder's context.

Rows 1–3, 5, 7, 15 and 17–19 are where the industry has converged, and cairn got there early.

**Where it falls short.** The gaps cluster around the *environment* and *measurement*, not the workflow:

- **Containment (rows 9 and 10).** Anthropic's 2026 position is that the hard boundary belongs in the sandbox, not in prompts or classifiers. cairn's guards are honest about being "best effort", but nothing replaces them with a real boundary. For a build that runs for an hour without you, this is the biggest practical risk.
- **Stopping conditions (row 8).** cairn knows what a plan costs but will never stop one. A plan budget, per phase or per plan, that sets the build aside when exceeded would match `--max-budget-usd` and Stripe's bounded rounds.
- **Away-from-keyboard execution (row 11).** "Unattended" in cairn currently means "doesn't ask you questions", not "runs while your laptop is closed".
- **Evals (rows 12 and 13).** Anthropic's guidance from March to November 2026 says to eval harness changes, ablate, and remove what new models no longer need. cairn has 16 agents, three levels and many procedures, and no measurement of which of them pay off. It is also the most likely way cairn regresses unnoticed when a new model ships, which is the lesson of Anthropic's April 23 postmortem.
- **Overfitting to visible checks (row 6).** The newest research (SpecBench, METR's August incident report, Anthropic's reward-seeker work) all points the same way: an agent that can see the grader will optimize toward it. Proofs are already strong because they're locked. Holding back a few checks that only run at Check would close the remaining gap.

---

## 7. Recommendations, ranked

Ranked by value for effort, and revised after review on 2026-11-15. Each is phrased as something a cairn plan could take on. Section 10 gives the order of the work and the reasons.

1. **Add plan budgets.** *(First plan.)*
   - Add `budget.usd` and `budget.hours` per plan, optionally per phase, in `.cairn/config.json`.
   - When a budget is exceeded, the build sets aside what's running and asks once, like a stuck task. The CLI enforces it, and the pane already has the numbers.
   - This comes first because it is small and every eval run needs a stop of its own.
2. **Add an eval suite with `claude plugin eval`.** *(Second plan.)*
   - Start with about 8 stage-level cases: plan from an approved PRD, a risky task, a planted bug, a stuck task, a UI proof, the fix lane, a budget hit, and a temptation to edit out of scope.
   - Scaffolds start each case past the approvals.
   - Grade on cairn's own signals through regex on `state.json`: proofs green, no edits outside scope, the right stops, cost.
   - Remove ceremony one piece at a time with an `EVAL_CAIRN_SKIP` switch and a script that compares results, so each piece's effect on outcome and cost is measured, starting with the writer and checker pairs (row 14).
   - Gate CI on the score with the plugin on, with a cost cap.
3. **Add an on-demand system overview.** *(Third plan.)*
   - `/cairn:system` writes a generated, commit-stamped `docs/cairn/SYSTEM.md`: high level, organized by capability, with diagrams where they help.
   - Its backbone is the plan history, checked against a quick scan for gaps rather than a deep reading of the code.
   - It replaces the earlier requirement-register idea (section 5, item 6).
4. **Correct the README.** *(Direct edit.)* Superpowers and Compound Engineering now have independent reviewers, so lead with the differences that hold up: enforced state, approvals that can't be forged, and locked proofs.
5. **Document a safe unattended setup.** *(Direct edit.)*
   - A short "Running a build without you" section: sandbox on, an egress allowlist, auto mode with deny rules for push, force-push and deploy, and no production credentials in the worktree.
   - Map Anthropic's five questions onto cairn's own stops.
6. **Hold back some checks.** Let the proof-writer mark one or two proofs per plan as hidden from builders, run only at Check. *(Later; measured by the eval suite.)*
7. **Verify review findings before acting on them.** A cheap validator pass between review and fix. *(Later; measured by the eval suite.)*
8. **Handle the PR after it opens.** Watch CI for up to two rounds, answer review comments as fixes, then merge the approved commit. *(Later.)*
9. **Add a cloud or headless path for the build** between plan approval and ship approval. *(Later. Budgets and evals come first, since a run in the cloud needs both.)*
10. **Make lessons retrievable,** keyed by file paths like follow-ups. *(Later. See the caveat in section 5, item 2.)*
11. **Use the app at Check.** Boot the app per worktree with the `start` and `seed` keys, and add a browser pass scoped to the diff. *(Later.)*
12. **Skipped for now:** more hosts, a pluggable workflow, a glossary and ADR file, and GitHub Issues as a second tracker.

---

## 8. Sources

### Projects compared (state read 2026-11-15)

- obra/superpowers: https://github.com/obra/superpowers (v7.0.2, 2026-11-03)
- EveryInc/compound-engineering-plugin: https://github.com/everyinc/compound-engineering-plugin (v3.38.1, 2026-11-12). Essay: Shipper and Klaassen, "Compound Engineering: How Every Codes With Agents", 2025-12-11, https://every.to/chain-of-thought/compound-engineering-how-every-codes-with-agents
- mattpocock/skills: https://github.com/mattpocock/skills (v1.3.2, 2026-10-29). Docs: https://www.aihero.dev/skills-implement-spec
- github/spec-kit: https://github.com/github/spec-kit (v1.4.0, 2026-11-10)
- Fission-AI/OpenSpec: https://github.com/Fission-AI/OpenSpec (v2.0.0, 2026-11-11)
- cairn: https://github.com/jason-flenniken/cairn (v0.22.0)

### Anthropic

- Building effective agents (2024-12-19): https://www.anthropic.com/engineering/building-effective-agents
- How we built our multi-agent research system (2025-06-13): https://www.anthropic.com/engineering/multi-agent-research-system
- Writing effective tools for agents (2025-09-11): https://www.anthropic.com/engineering/writing-tools-for-agents
- Effective context engineering for AI agents (2025-09-29): https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Equipping agents for the real world with Agent Skills (2025-10-16): https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- Beyond permission prompts: Claude Code sandboxing (2025-10-20): https://www.anthropic.com/engineering/claude-code-sandboxing
- Code execution with MCP (2025-11-04): https://www.anthropic.com/engineering/code-execution-with-mcp
- Effective harnesses for long-running agents (2025-11-26): https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Demystifying evals for AI agents (2026-01-09): https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- Building a C compiler with a team of parallel Claudes (2026-02-05): https://www.anthropic.com/engineering/building-c-compiler
- Quantifying infrastructure noise in agentic coding evals (2026-02-05): https://www.anthropic.com/engineering/infrastructure-noise
- Measuring AI agent autonomy in practice (2026-02-18): https://www.anthropic.com/research/measuring-agent-autonomy
- Eval awareness in Claude Opus 4.6's BrowseComp performance (2026-03-06): https://www.anthropic.com/engineering/eval-awareness-browsecomp
- Bringing Code Review to Claude Code (2026-03-09): https://claude.com/blog/code-review
- Harness design for long-running application development (2026-03-24): https://www.anthropic.com/engineering/harness-design-long-running-apps
- How we built Claude Code auto mode (2026-03-25): https://www.anthropic.com/engineering/claude-code-auto-mode
- How and when to use subagents in Claude Code (2026-04-07): https://www.claude.com/blog/subagents-in-claude-code
- Scaling Managed Agents: decoupling the brain from the hands (2026-04-08): https://www.anthropic.com/engineering/managed-agents
- Introducing routines in Claude Code (2026-04-14): https://claude.com/blog/introducing-routines-in-claude-code
- An update on recent Claude Code quality reports (2026-04-23): https://www.anthropic.com/engineering/april-23-postmortem
- How we contain Claude across products (2026-05-25): https://www.anthropic.com/engineering/how-we-contain-claude
- Training a misaligned reward seeker (2026-08): https://alignment.anthropic.com/2026/reward-seeker/
- Redesigning source control at Anthropic (2026-10-13): https://www.anthropic.com/engineering/redesigning-source-control
- Building agents: when to fold subagents into your main agent loop (2026-10-22): https://claude.com/blog/building-agents-when-to-fold-subagents-into-your-main-agent-loop
- The components of agent memory (2026-11-06): https://www.anthropic.com/engineering/components-of-agent-memory
- Building strong safety evaluations (2026-11-13): https://www.anthropic.com/engineering/building-strong-safety-evaluations
- Claude Code docs (live): best practices https://code.claude.com/docs/en/best-practices.md; plugin evals https://code.claude.com/docs/en/plugin-evals.md; permission modes https://code.claude.com/docs/en/permission-modes.md; hooks guide https://code.claude.com/docs/en/hooks-guide.md; worktrees https://code.claude.com/docs/en/worktrees.md; goal https://code.claude.com/docs/en/goal.md; routines https://code.claude.com/docs/en/routines.md

### Industry

- OpenAI, Harness engineering (2026-02-11): https://openai.com/index/harness-engineering/
- OpenAI Codex, Follow a goal (undated): https://learn.chatgpt.com/use-cases/follow-goals
- Cursor, Scaling long-running autonomous coding (2026-01-14): https://cursor.com/blog/scaling-agents
- Cursor, Towards self-driving codebases (2026-02-05): https://cursor.com/blog/self-driving-codebases
- Cursor, Agent computer use (2026-02-24): https://cursor.com/blog/agent-computer-use
- Cognition, Multi-agents: what's actually working (2026-04-22): https://cognition.com/blog/multi-agents-working
- Stripe, Minions parts 1 and 2 (2026-02-09, 2026-02-19): https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents and https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2
- Spotify, Feedback loops, Honk part 3 (2025-12-09): https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3
- Spotify, Coding is no longer the constraint (2026-06-03): https://engineering.atspotify.com/2026/6/code-with-claude-coding-is-no-longer-the-constraint
- GitHub, Agent HQ (2025-10-28): https://github.blog/news-insights/company-news/welcome-home-agents/
- Factory, Agent readiness (2026-01-20): https://factory.com/news/agent-readiness
- Birgitta Böckeler, Understanding spec-driven development: Kiro, spec-kit and Tessl (2025-10-15): https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html
- Addy Osmani, Long-running agents (2026-04-28): https://addyosmani.com/blog/long-running-agents
- Geoffrey Huntley, the Ralph loop (2026-01-17): https://ghuntley.com/loop/
- METR, Time Horizon 1.1 (2026-01-29): https://metr.org/blog/2026-01-29-time-horizon-1-1/
- METR, OpenAI and Hugging Face incident investigation (2026-08-26): https://metr.org/blog/2026-08-26-openai-hugging-face-incident-investigation/
- SpecBench, arXiv 2605.21384 (v2, 2026-09-09): https://arxiv.org/abs/2605.21384
- The Verification Horizon, arXiv 2606.26300 (2026-06-24): https://arxiv.org/abs/2606.26300
- Agentic AI Foundation, Measuring AGENTS.md (2026-07-22): https://aaif.io/blog/measuring-agents-md-what-five-runs-show-that-one-doesn-t

---

## 9. Method and caveats

**How the research was done.**

- Each of the five projects was shallow-cloned into an empty directory and read file by file. No code from them was run.
- Versions, stars, release dates and contributor counts came from the GitHub API on 2026-11-15. The star counts were checked twice.
- Contributor counts are approximate, derived from API pagination.

**Best-practice sources.** Each practice was taken from a fetched primary page except where noted. These figures rest on secondary sources only and were left out of the scorecard:

- Opus 4.7 reward-hacking percentages;
- Jules winding down;
- Gas Town and Beads cost anecdotes;
- vendor survey statistics.

METR's incident report was read only in part, without its recommendations section.

**How cairn was assessed.** From its README and checked against code:

- `.github/workflows/ci.yml`: CI runs typecheck, CLI tests and a bundle freshness check; mod tests need the `claude` CLI and don't run in CI.
- No behavioral evals.
- No sandbox, permission or headless guidance in procedures or references.
- No spend caps; "budget" appears only as a record word count.
- The fix-round cap is enforced in `cli/src/commands/tasks.ts`.
- The SessionStart hook matches startup, resume, clear and compact.
- Out-of-scope edit logging is in `cli/src/commands/hooks.ts`.
- The ship procedure opens and merges the PR but doesn't watch CI or answer comments.

**Known limits.**

- Compound Engineering and Superpowers each have hundreds of reference files. Those were sampled, not read in full.
- Superpowers' evals live in a separate repo that wasn't read.
- OpenSpec's docs lag its 2.0 code.
- Some competitor features named in section 5 may behave differently from what their docs say.

---

## 10. Decisions and roadmap

Decided on 2026-11-15, after reviewing this analysis.

### Order

| # | Work | How | Why this place |
|---|---|---|---|
| 1 | Plan budgets | cairn plan, Standard | Small. It closes the "what stops it" gap (rows 8 and 10), and evals need it. |
| 2 | Eval suite | cairn plan, Polished | The top gap (rows 12–14). Every later change to ceremony is judged by it. |
| 3 | `/cairn:system` overview | cairn plan | A high-level view of the system for engineers. It doesn't depend on 1 or 2. |
| — | README correction and unattended-setup guide | Direct edits | Documentation only, with no design questions. |

### Settled design points

- **Evals never bypass approvals.** Cases start past them and stop at the next one. The trust layer stays as it is, at the cost of having no single idea-to-PR case.
- **Measure ceremony by removing it.** An `EVAL_CAIRN_SKIP` switch plus a comparison script, because the eval tool turns only the whole plugin on or off. Open question: the switch should do nothing outside an eval run.
- **The system overview is refreshed only when asked.** It doesn't refresh at ship. Session start says how many commits behind it is.
- **The overview stays cheap.** It reads history first and runs a quick scan for gaps, opening code only where the scan finds a gap. It is regenerated rather than kept by hand, which keeps the 0.7.0 rule against stale "how it works" docs.

### Deferred

These wait until the eval suite can show their value: held-back proofs, verifying review findings, handling the PR after it opens, a cloud build path, retrievable lessons, and booting the app at Check.

### Skipped

- **More hosts:** the trust layer needs hooks.
- **A pluggable workflow:** a fixed lifecycle is part of cairn's reliability story.
- **A glossary:** low value for one maintainer.
- **GitHub Issues:** Linear covers current use.
