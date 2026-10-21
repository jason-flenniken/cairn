# cairn: a personal agent-driven SDLC plugin

## Context
Jason uses Compound Engineering (CE) and previously Superpowers (SP). Both fall short on:
- long-running plans
- running the same steps every time
- showing the big picture: where we are, what's done, what's next
- guided prompts

The research turned up one root cause shared by CE, SP, and Matt Pocock's skills: **every stage is prose the model may or may not follow.** None of them uses hooks to enforce stage transitions, and none keeps a persistent status for each plan.

**cairn** is a self-contained Claude Code plugin that fixes this. It has four parts:
- a script-owned state machine for each plan
- a fixed stage sequence with human stops
- a live side pane, built as a Claude Code mod, with pause and resume
- layered testing: TDD, acceptance against the PRD, unhappy-path "breaker", and a blind first-timer

It borrows the best pieces of CE, SP, Pocock, and the Vercel pack. All three plugins are MIT, so copies keep their notices.

## Givens
- **Reporting:** the plugin's user-facing reports follow the output contract in `~/.claude/CLAUDE.md`, encoded once in `references/reporting.md`:
  - outcome first
  - 1–3 line progress
  - a decision leads, followed by `Why:`
  - no bare IDs
  - no plumbing nouns
- **Models:** every subagent cairn launches sets an explicit `model` (haiku/sonnet/opus), via agent frontmatter or the dispatch call.
- **Name:** the name is easy to change. The brand appears only in `plugin.json`, `marketplace.json`, and the `bin/` filename, and `scripts/rename.sh <new>` updates all three. Data paths are brand-neutral: `docs/sdlc/` and `.sdlc/`.

## Decisions (from grilling)
1. **Tracks.** There are three:
   - Product track: a whole-app PRD on main, made of PRD.md, a ROADMAP generated from plan states, and ADRs. PRD.md holds vision, users, non-goals, NFRs, and MUST NOT TRADE OFF.
   - Feature track: one plan per roadmap item. Each plan inherits the product constraints.
   - Fast lane: `/cairn:fix`.

   Greenfield work adds a stack/ADR decision and a "foundations" plan first.
2. **State.** There is one `state.json` per implementation plan, and the bundled CLI is its only writer. `STATUS.md`, `INDEX.md`, and `ROADMAP.md` are generated from it.
3. **Where state lives.** A plan gets its own branch `sdlc/<slug>` and worktree when it is created. The directory `docs/sdlc/plans/<date>-<slug>/{decisions.md, prd.md, plan.md, state.json, STATUS.md, handoff.md}` is committed on that branch. The cross-plan view reads other branches via `git for-each-ref refs/heads/sdlc/*` plus `git show`.
4. **Enforcement is hard at checkpoints.** The CLI refuses a transition that lacks its evidence:
   - an approval
   - artifacts with their required sections
   - green tests
   - resolved blocking findings

   Edits outside the plan's file scope are logged as drift, not blocked. Every `--override "reason"` is logged. Status is re-injected on startup, clear, and compact.
5. **Stage sequence:**
   1. Discover
   2. PRD, then **STOP**
   3. Plan, then **STOP**
   4. Execute, one phase at a time, with slices in parallel. **STOP** at each phase end with a menu: continue / fix / re-plan / pause.
   5. Verify
   6. Review, then **STOP: ship?**
   7. Ship
   8. Learn
6. **Interview style.** One decision at a time through AskUserQuestion, each with a recommended answer and a preview. Facts come from research agents first. Every answer is appended to `decisions.md` immediately. The interview ends when the list of open decisions is empty. Then:
   1. Draft the PRD.
   2. Builder-check: a fresh agent lists what it would still need to ask.
   3. Doc-review lenses.
   4. STOP.
7. **Parallel execution.**
   - A plan is a set of phases, each made of vertical slices. Each slice has `blocked_by` and a file scope.
   - The CLI computes the ready set and never schedules two slices with overlapping scopes at once.
   - Each ready slice runs in its own worktree off the plan branch, at most 3–4 at once.
   - The orchestrator merges slices in dependency order. The full test suite runs on the merged tree before `slice done`.
8. **App types for Verify.** Web (Chrome/Playwright), React Native/Expo (Maestro, building on `~/.claude/skills/sim-test`), and APIs (HTTP scripts). Each repo's `.sdlc/config.json` declares its types plus its start, seed, test, and build commands.
9. **Layered testing.**
   - Per slice: TDD covering the plan's happy, unhappy, and security cases.
   - Phase end: the acceptance paths so far, a drift check, and the breaker run on the surfaces that changed.
   - Verify: the full acceptance suite plus performance targets, the full breaker, and the blind first-timer.

   Findings become fix slices.
10. **Review.**
    - Per slice: a sonnet reviewer checks the spec (missing, extra, misunderstood) and quality.
    - Review stage:
      1. A simplify pass.
      2. A fixed set of reviewers that always runs: security, simplicity/YAGNI, correctness, performance, test quality.
      3. Reviewers triggered by file-pattern rules: data-migration, api-contract, frontend-races.
      4. An opus pass that dedupes, ranks, and maps findings to PRD requirements.

    Blocking findings become fix slices, and the CLI blocks ship until they are resolved.
11. **Status UI.** A mod ships in the same plugin. The **side pane** is the primary view: plans, stage, phase/slice tree, running agents, drift, and pending stops, with buttons. Status-line text and `/cairn:status` cover narrow terminals and `-p`. The mod only reads state, draws, and calls the CLI.
12. **Pause and resume.**
    - Pause drains: in-flight slices finish their current sub-step, work in progress is committed in their worktrees, and `handoff.md` is written.
    - In the next session, the pane lists every plan with its next action and a Resume button. Resume re-runs only the unfinished sub-steps.
    - "Stop now" skips the drain. `/cairn:resume <plan>` is the fallback.
13. **Ticketing.** A one-way mirror, opt-in per repo, built as an adapter (Linear first). The mapping:
    - plan → project
    - phase → milestone
    - slice → issue with blocked-by links
    - blocking finding → issue

    The only inbound path is `cairn new --from-linear <issue>`.
14. **Packaging.** Self-contained, with vendored and rewritten copies. Copyright notices go in `NOTICE` and source commits in `UPSTREAM.md`. There is no runtime dependency on CE, SP, or Pocock. Disable CE and SP in repos that use cairn.
15. **Fast lane.** `/cairn:fix` creates a tracked one-slice plan:
    1. Repro first. The CLI refuses to continue until a failing test exists.
    2. TDD, covering unhappy and security cases.
    3. Slice review plus the security reviewer.
    4. The breaker on the touched surface.
    5. One STOP.

    It escalates to the full lifecycle when it exceeds about 8 files or new requirements appear.
16. **Build order is spine first.** v0.1 is built by hand. v0.2 onward is built using cairn itself.

17. **Completion record.** When a plan is done, verified, and tested, the close step writes `docs/sdlc/plans/<date>-<slug>/RECORD.md`. It is about one page, with a hard length budget, and has these sections:
    - **Links:** the PRD, the plan, the PR, and the Linear project if there is one.
    - **Why:** the problem and goals, two or three sentences from the PRD.
    - **What was built:** one or two lines per phase, user-visible outcomes first.
    - **How it works:** a short paragraph naming the key components, the data flow, and the entry-point files.
    - **Evidence:** the verdicts from acceptance, breaker, first-timer, and review, each one line with counts.
    - **Deviations:** accepted drift, overrides, and spec changes made along the way.
    - **Follow-ups:** advisory findings and anything deferred.

    A recorder agent (sonnet) drafts it from state, the PRD, the plan, and the git log. `cairn close` refuses unless Verify and Review have passed and RECORD.md has every section. The PR body is built from the same record. On merge, the record lands on main, and INDEX.md and ROADMAP.md link to it.

## Defaults I chose (flag if you disagree)
- **CLI in TypeScript.** It is bundled with esbuild into a single zero-dependency `bin/cairn.mjs` (Node ≥ 20) and shares the state-schema types with the mod.
- **The CLI is the router.** The stage procedures live as plain files in `procedures/{discover,prd,plan,execute,phase-end,verify,review,ship,learn,fix}.md`.
  - `cairn next --json` returns the stage, the sub-step, and which procedure file to follow.
  - `/cairn:next` reads that file and executes it. It's the one command to remember.
  - `/cairn:discover`, `/cairn:prd` and the others are thin user-typed wrappers around the same files.

  All skills are `disable-model-invocation: true`, so nothing auto-triggers the way SP's "1% rule" does, and no skill ever calls another skill.

## How state finds its way around worktrees
- **Which plan a session is on.** The current branch decides. On `sdlc/<slug>` the session works on that plan; on main it sees the index of all plans. The CLI resolves the plan worktree's path from any directory, including slice worktrees, and always writes state there.
- **Live cross-plan view.**
  - The CLI finds each plan's worktree with `git worktree list --porcelain` and reads its live `state.json` from disk.
  - It uses `git show` only for plan branches with no checked-out worktree.
- **Slice worktrees** use the branch namespace `sdlc-slice/<plan>/<slice>`, so a scan of plan branches (`refs/heads/sdlc/*`) never picks them up. Slice workers never touch `docs/sdlc/`; the orchestrator's merge excludes it.
- **Commit cadence.** `state.json` and the generated docs are committed on the plan branch at transitions only: approve, advance, `slice done`, pause, and resume. Sub-step updates are written to disk but not committed.
- **Resume from main** prints `cd <worktree> && claude` or uses the EnterWorktree tool when the session supports it. In v0.2 the pane's Resume button does the same.
- **Human approvals:**
  - In v0.1, the skill asks through AskUserQuestion and then calls `cairn approve`. The CLI records this as `via: agent`.
  - In v0.2, approvals move to pane buttons or a mod `/cairn:approve` command, which run without a Claude turn and so are provably human. The mod then denies the model's own `cairn approve` Bash calls.
- **Plan format:** `plan.md` is prose, plus one fenced `yaml cairn-slices` block, which `cairn plan load` parses into state and validates: no cycles, scopes declared, every slice mapped to PRD requirement IDs.

## Repo layout (`/Users/jasonflenniken/Development/ai_workflow`, git init)
```
.claude-plugin/marketplace.json       local marketplace → plugins/cairn
plugins/cairn/
  .claude-plugin/plugin.json
  bin/cairn.mjs                       built CLI (committed)
  cli/src/{state,transitions,plan-parse,ready,git,render,inject,config}.ts
  cli/schema/state.schema.json
  cli/test/*.test.ts                  node:test
  skills/{next,new,discover,prd,plan,execute,status,pause,resume}/SKILL.md   (v0.1, thin wrappers)
  procedures/{discover,prd,plan,execute,...}.md                              (the real steps; CLI-routed)
  agents/{implementer,slice-reviewer,builder-check,doc-reviewer}.md          (v0.1)
  hooks/hooks.json                    classic: SessionStart→inject, PostToolUse(Edit|Write)→drift
  hooks/register.tsx                  mod (v0.2)
  templates/{product-prd,roadmap,prd,plan,decisions,status,handoff,record}.md
  references/{reporting,writing-for-agents}.md
  NOTICE  UPSTREAM.md  scripts/{rename.sh,upstream-diff.sh}
sources/                              existing Vercel pack + reference clones (not shipped)
```

## v0.1: the spine (implement now)
1. **Scaffold.** Git init, the marketplace, `plugin.json`, the esbuild build, and the node:test harness. Copy the reference clones out of the scratchpad into `sources/` (CE, SP, Pocock at their recorded SHAs) for later diffing.
2. **State and CLI.** Commands: `next [--json]`, `new`, `status [--all|--json]`, `decide`, `approve`, `advance`, `plan load`, `ready`, `slice start|step|done`, `drift log`, `pause [--now]`, `resume`, `render`, `inject`, plus `--override` on any refusable command.
   - Every refusal names the missing evidence and the exact command to fix it, in the style of the preview shown during grilling.
   - Borrow SP's plan-keyed ledger idea (`skills/subagent-driven-development/scripts/sdd-workspace`) and the test-gated `task-done` (`skills/executing-plans/scripts/task-done`).
   - Borrow Pocock's frontier logic (`implement-spec`).
3. **Templates.**
   - **PRD:** merges Pocock's `to-spec` (problem, solution, numbered user stories, implementation and testing decisions, out of scope) with Vercel's PRD conventions (FR IDs, non-goals, NFRs, MUST NOT TRADE OFF) and CE's stable requirement IDs. Adds required sections for acceptance criteria, unhappy paths, security considerations, and open questions.
   - **Plan:** SP's header (Goal, Architecture, Global Constraints, Review Focus). Each slice has interfaces, a file scope, `blocked_by`, happy/unhappy/security test cases, the PRD IDs it covers, and a complexity value that maps to a model.
4. **Procedures** (with thin skill wrappers). Each procedure:
   - starts with `cairn status --json` and refuses if the stage is wrong
   - gives every step a "Done when" line (Pocock's `writing-for-agents`)
   - ends with a CLI transition

   Their sources:
   - discover: this session's grilling pattern plus `~/.claude/skills/grill-me`
   - prd: plus SP's `brainstorming/builder-check-prompt.md` and CE's doc-review lenses
   - plan: Pocock's `to-tickets` slice rules plus CE's `execution-strategy.md` parallel-safety check
   - execute: Pocock's `implement-spec` (worktrees, merger) plus SP's implementer, task-reviewer, and re-review prompts, including the 5-round fix circuit breaker
   - status, pause, resume, next
5. **Agents.** Each has an explicit `model:` in its frontmatter:
   - implementer (sonnet)
   - slice-reviewer (sonnet)
   - builder-check (sonnet)
   - doc-reviewer (sonnet)
6. **Close and record.** Add the `cairn close` command, the `record.md` template, and a recorder agent (sonnet). In v0.1, close is gated on every phase being done plus the plan's tests passing; v0.3 adds the Verify and Review gates.
7. **Classic hooks.** SessionStart on startup, clear, and compact runs `cairn inject`. PostToolUse on Edit and Write runs `cairn drift log`, which only logs.

## Later versions (each planned and built with cairn itself)
- **v0.2:**
  - the mod: side pane, status line, `/cairn:approve` and resume buttons, and denying the model's own approvals
  - the phase-end drift check, adapted from Vercel's `/direction`, against both the plan PRD and the product PRD
  - `/cairn:fix`
- **v0.3:** Verify agents with web, Expo, and API drivers:
  - breaker (from Vercel's `breaker`)
  - first-timer, blinded by a hook adapted from `first-timer-bash.mjs`
  - acceptance runner (from Vercel's `pathrunner`)

  Also the full review roster, using CE's `ce-code-review` persona catalog and `findings-schema.json`, and the simplify pass.
- **v0.4:**
  - the Linear adapter
  - the Learn stage, using CE's `ce-compound` schema and writing to `docs/sdlc/learnings/`
  - `upstream-diff.sh`
  - product-track ROADMAP generation

## Verification
- **CLI unit tests (node:test).** Cover:
  - every transition, including refusals with no approval, red tests, or missing PRD sections
  - DAG cycle detection
  - the ready set under scope overlap
  - cross-branch status in a temporary git repo with two plan branches
  - pause and resume sub-step recovery
  - render output
- **Plugin checks.** `claude plugin validate plugins/cairn`. Also `claude plugin eval` with trigger and behavior cases: `/cairn:next` routes correctly from every stage.
- **Skill pressure tests,** following SP's `writing-skills/testing-skills-with-subagents.md`. For each skill, give a subagent a scenario that tempts it to skip a step. For example: "tests are flaky, just mark the slice done". Confirm the skill plus the CLI holds the line.
- **Dogfood.**
  1. Install from the local marketplace (`/plugin install cairn@ai-workflow`) into a scratch repo.
  2. Run `/cairn:next` from a new idea through PRD, plan, and one parallel phase of two slices. Pause mid-phase, `/clear`, and resume.
  3. Confirm only the unfinished sub-steps re-run and that `STATUS.md` is correct.
  4. Then use v0.1 to run the v0.2 plan on this repo.

## Appendix A: Research summary
None of the sources has a persistent status for each plan, and none enforces stage transitions.

| Need | CE | SP | Pocock | Vercel pack |
|---|---|---|---|---|
| PRD | unified plan with requirement IDs | free-form design doc | `to-spec` template | `specs/prd.md` + `specs/features/*.md` |
| Phased/parallel plan | units + deps, waves of 3–5 | none (forbids parallel) | ticket frontier + worktrees + merger | — |
| Status/resume | none by design ("progress is in git") | per-plan ledger + test-gated `task-done` | wayfinder map (decisions only) | — |
| Drift check | review-time requirements check | spec-compliance reviewer | code-review spec axis | `/direction` (best) |
| Review | 15+ personas, findings schema | task + final reviewer | 2-axis | — |
| Real-user/unhappy-path testing | ce-dogfood, ce-test-browser | — | — | first-timer (hook-blinded), breaker, pathrunner |
| Tickets | write-only sink | none | GitHub/local only | /triage |

## Appendix B: Borrow map
Reference clones were made 2026-10-20. Copy them to `sources/` in step 1 and record them in `UPSTREAM.md`:
- CE `github.com/everyinc/compound-engineering-plugin` @ `2e41b4490a37f53db0beb6d4904618da9af2f559`
- SP `github.com/obra/superpowers` @ `bb92a77741419a4ab5f06e711a283343f1ada0c3`
- Pocock `github.com/mattpocock/skills` @ `5beb35b040e3de97e54fa9e386d7e42d15c295c2`

| Into cairn | From |
|---|---|
| CLI ledger, test-gated slice done | SP `skills/subagent-driven-development/scripts/{sdd-workspace,task-brief,review-package}`, `skills/executing-plans/scripts/{task-start,task-done}` |
| plan template | SP `skills/writing-plans/SKILL.md`; CE `skills/ce-plan/references/{plan-sections,structure}.md` |
| implementer / slice-reviewer / re-review | SP `skills/subagent-driven-development/{implementer,task-reviewer,re-review}-prompt.md` |
| builder-check | SP `skills/brainstorming/builder-check-prompt.md` |
| verification rule | SP `skills/verification-before-completion/SKILL.md`; `~/.claude/skills/verification` |
| TDD | SP `skills/test-driven-development/SKILL.md`; Pocock `skills/engineering/tdd/` |
| skill pressure tests | SP `skills/writing-skills/testing-skills-with-subagents.md`, `docs/superpowers/specs/2026-06-10-positive-instruction-redesign-design.md` |
| parallel safety, orchestrator-owned merge | CE `skills/ce-work/references/execution-strategy.md`; Pocock `skills/engineering/implement-spec/SKILL.md` |
| settled decisions, evidence-first loop | CE `skills/ce-work/references/implementation-loop.md` |
| drift check | Vercel `sources/vercel-ceo/.claude/commands/direction.md`; CE `skills/ce-code-review/references/intent-and-plan.md` |
| review roster + findings | CE `skills/ce-code-review/references/{persona-catalog.md,personas/,findings-schema.json,action-class-rubric.md}` |
| doc review lenses | CE `skills/ce-doc-review/` |
| PRD template | Pocock `skills/engineering/to-spec/SKILL.md`; Vercel PRD conventions |
| slicing rules | Pocock `skills/engineering/to-tickets/SKILL.md`, `skills/engineering/triage/AGENT-BRIEF.md` |
| index/map and frontier | Pocock `skills/engineering/wayfinder/SKILL.md`, `setup-matt-pocock-skills/issue-tracker-local.md` |
| context hygiene at stops | Pocock `skills/engineering/ask-matt/PHASE-BOUNDARIES.md` |
| skill-writing style | Pocock `skills/productivity/writing-for-agents/{SKILL,SKILL-MECHANICS}.md` |
| breaker / first-timer + hook / acceptance runner | Vercel `sources/vercel-ceo/.claude/{agents/breaker.md,agents/first-timer.md,hooks/first-timer-bash.mjs,agents/pathrunner.md}` |
| Expo driver | `~/.claude/skills/sim-test` |
| learnings | CE `skills/ce-compound/references/schema.yaml`, `assets/resolution-template.md` |
| tracker adapter shape | CE `skills/ce-work/references/tracker-defer.md`, `skills/ce-plan/references/plan-handoff.md` |
| checkpoint report pattern | CE `skills/ce-dogfood/references/dogfood-report-template.md` |

**Personal pieces to fold in or retire** once cairn covers them:
- `~/.claude/skills/{execute-plan, grill-me, grill-with-docs, to-prd, to-issues, tdd, triage, handoff, zoom-out, verification}`
- `~/.claude/commands/{create_handoff,resume_handoff}.md`

## Appendix C: What the mod can do (confirmed for CC ≥ v2.1.287)
- **Placement:** a mod ships in the same plugin as skills and agents.
- **UI:** a side pane (`$.ui.open` plus `ui.render` on `Pane`; it opens unasked only at ≥144 columns), a band above the prompt, `$.ui.status` status-line text, toasts, and buttons.
- **Commands:** `$.command.register` adds slash commands that run with no Claude turn. This is how approvals are proven to come from a human.
- **Control:** `tool.call` hooks can deny a call (for example, the model running `cairn approve` itself). `prompt.compose` injects status into the system prompt.
- **Other:** `$.store` persists across sessions, `$.fs` and `$.process` are available, and classic events are reachable as `classic.SessionStart`, `classic.Stop` and so on.
- **Limits:** drawing works in the terminal, Desktop, and VS Code. Hooks also run in `-p` but nothing is drawn there.
- **Hooks file:** one `hooks/hooks.json` can hold both the classic `hooks` key and `modules`, according to the mods reference. Confirm with `claude plugin validate`.
- **Why the CLI routes:** `disable-model-invocation: true` blocks model-initiated Skill calls, so a router skill couldn't chain the stage skills. Having the CLI hand back a procedure file avoids that.
