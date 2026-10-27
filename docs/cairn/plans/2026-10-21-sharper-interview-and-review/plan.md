# Plan: Sharper interview and review

> Source: prd.md. Each task is a thin, complete path through every layer, demoable on its own, and fits one context window.

## Goal
Make cairn's discover a goal-first interview, review every task on five labelled axes, run security from design to ship, and close a plan only once its branch is merged.

## Architecture
Most of the change is markdown the orchestrator and agents read: `procedures/*.md`, `agents/*.md`, two new `references/*-checklist.md` files that the agents read section by section, and the templates. One CLI change: `closeGates` in `cli/src/commands/stages.ts` gains a merged-into-base check (`gitOk` / `merge-base --is-ancestor`, as `tasks.ts` already does), and `progress()` in `cli/src/render.ts` labels an unmerged learn-stage plan "PR open". Pane polish stays in `hooks/mod/pane.tsx` and `approve.ts`. Doc checks follow the existing pattern in `cli/test/*.test.ts`, which assert key phrases in the markdown.

## Global constraints
- Reviewer labels are exactly: Critical, Required, Optional, Nit, FYI.
- Reviewer and security-reviewer agents are read-only: `tools: Read, Grep, Glob, Bash`, no Edit or Write.
- Reference paths are exactly `references/review-checklist.md` and `references/security-checklist.md`. Security sections are tagged `[web]`, `[api]`, `[data]`, `[llm]`, `[deps]`, `[fs]`.
- No new approve kinds: only prd, plan and ship (NFR-01). Each checklist stays under about 400 lines (NFR-02).
- Keep the existing doc-test needles passing (procedures.test.ts, fix-procedure.test.ts, dogfood-docs.test.ts, templates.test.ts).
- All user-facing wording follows `references/reporting.md`: plain words, no ids in user text.

## Phases

```yaml cairn-tasks
phases:
  - id: material
    name: Interview, checklists and close rule
    tasks:
      - id: goal-interview
        name: Goal-first interview
        covers: [FR-01, FR-02, FR-03, FR-04, FR-05]
        blocked_by: []
        scope: ["plugins/cairn/procedures/discover.md", "plugins/cairn/cli/test/interview-doc.test.ts"]
        complexity: standard
        risky: false
      - id: review-checklist
        name: Review checklist and reviewers
        covers: [FR-06, FR-09]
        blocked_by: []
        scope: ["plugins/cairn/references/review-checklist.md", "plugins/cairn/agents/task-reviewer.md", "plugins/cairn/agents/branch-reviewer.md", "plugins/cairn/cli/test/review-doc.test.ts"]
        complexity: standard
        risky: false
      - id: security-checklist
        name: Security checklist, reviewer and credit
        covers: [FR-10, FR-13, FR-22]
        blocked_by: []
        scope: ["plugins/cairn/references/security-checklist.md", "plugins/cairn/agents/security-reviewer.md", "plugins/cairn/agents/implementer.md", "plugins/cairn/NOTICE", "plugins/cairn/UPSTREAM.md", "plugins/cairn/cli/test/security-doc.test.ts"]
        complexity: standard
        risky: false
      - id: close-when-merged
        name: Close only when merged
        covers: [FR-17]
        blocked_by: []
        scope: ["plugins/cairn/cli/src/**", "plugins/cairn/cli/test/lifecycle.test.ts", "plugins/cairn/cli/test/close-merged.test.ts", "plugins/cairn/procedures/learn.md", "plugins/cairn/procedures/ship.md", "plugins/cairn/dist/**"]
        complexity: standard
        risky: true
        riskReason: "changes when the CLI refuses to close a plan; a wrong check blocks every close"
  - id: wiring
    name: Wire into the flow
    tasks:
      - id: review-routing
        name: Review every task and fix-track routing
        covers: [FR-07, FR-08, FR-14, FR-16, FR-21]
        blocked_by: [review-checklist, security-checklist, close-when-merged]
        scope: ["plugins/cairn/procedures/execute.md", "plugins/cairn/procedures/review.md", "plugins/cairn/procedures/fix.md", "plugins/cairn/references/model-tiers.md", "plugins/cairn/cli/test/fix-procedure.test.ts", "plugins/cairn/cli/test/routing-doc.test.ts"]
        complexity: standard
        risky: false
      - id: security-design
        name: Threat model, wider risk and pre-ship scans
        covers: [FR-11, FR-12, FR-15]
        blocked_by: [security-checklist]
        scope: ["plugins/cairn/templates/prd.md", "plugins/cairn/templates/plan.md", "plugins/cairn/templates/config.json", "plugins/cairn/procedures/prd.md", "plugins/cairn/procedures/plan.md", "plugins/cairn/procedures/verify.md", "plugins/cairn/references/cli.md", "plugins/cairn/cli/test/security-flow-doc.test.ts"]
        complexity: standard
        risky: false
      - id: pane-polish
        name: Pane background, notice and truncation
        covers: [FR-18, FR-19, FR-20]
        blocked_by: []
        scope: ["plugins/cairn/hooks/**"]
        complexity: simple
        risky: false
```

### Task: goal-interview

**Check:** discover.md walks guess and confidence, goal questions with a guess attached, goal implications, decisions including trust boundaries, and a read-back card that needs an explicit yes. A doc test asserts each step, and that "just enough" and "completeness" are gone.

**Interfaces**
- Consumes: none
- Produces: the discover steps. Decisions recorded with `cairn decide`, including the read-back card as the last decision before `cairn advance`. The step 2b follow-up flow is kept as is.

### Task: review-checklist

**Check:** `references/review-checklist.md` has the five axes, the label table, structural fixes, change and file size, dead code, dependencies, the verification-story check and the honesty rules. task-reviewer and branch-reviewer read it and emit labelled findings, each Critical or Required one with a proposed fix. A doc test asserts these.

**Interfaces**
- Consumes: none
- Produces: the reviewer output shape both reviewers share, which review-routing parses:
  ```
  Verdict: PASS | FIX            (FIX when any Critical or Required)
  Findings, most severe first:
  1. <Critical|Required|Optional|Nit|FYI> | <area: tests|security|perf|quality|ux|docs> | path:line | problem | proposed fix
  ```
  The branch reviewer keeps its `Strengths:` line and the FR id on each finding.

### Task: security-checklist

**Check:** `references/security-checklist.md` has tagged sections. `agents/security-reviewer.md` (read-only, sonnet) reads the matching sections and returns the shared output shape. implementer.md lists the ask-first items with NEEDS_CONTEXT. NOTICE and UPSTREAM.md credit addyosmani/agent-skills. A doc test asserts these.

**Interfaces**
- Consumes: the output shape from review-checklist (restate it in the agent; don't import it)
- Produces: the `security-reviewer` agent name; the ask-first list wording in implementer.md

### Task: close-when-merged

**Check:** `cairn close` on a plan whose branch is not merged into base exits 2 with a message that the pull request is still open. After the branch is merged it closes. `cairn status` shows "PR open" for a learn-stage plan that isn't merged yet.

**Interfaces**
- Consumes: `gitOk` (cli/src/git.ts), `closeGates` (cli/src/commands/stages.ts), `progress` (cli/src/render.ts)
- Produces: a merged check used by both close paths (feature `cmdClose` and the fix-track close in `cmdAdvance` from ship). Prefer the remote base when `origin/<base>` exists, after `git fetch origin <base>`, falling back to the local base. When the fetch fails, refuse with "merge status unknown" (overridable through the existing `--override` path). learn.md and ship.md tell the orchestrator to merge the PR (asking the user: merge now / I'll merge it), then close. Rebuild `dist/cairn.mjs`.

**Test cases**
- Happy: plan at learn, branch merged into main → `cairn close` exits 0 and the stage is closed.
- Unhappy: plan at learn, branch not merged → exit 2, the message names the open pull request, the stage stays learn, and status shows "PR open".
- Unhappy: fix plan at ship, branch not merged → `cairn advance` is refused the same way.
- Security: an `--override` without human proof is still refused (the existing `gate()` rule holds for the new check).

### Task: review-routing

**Check:** in execute.md every task goes to the task reviewer, and risky tasks also go to the security reviewer, in parallel. Critical and Required go to one fix attempt, Optional and Nit to `cairn suggest add`, and FYI is shown once. review.md runs branch-reviewer plus security-reviewer on the branch, with the same routing. fix.md reviews every fix, uses the wider risky list, merges before close, and matches FR-21. model-tiers lists the security reviewer. Existing doc tests pass, and a new doc test asserts the routing.

**Interfaces**
- Consumes: the reviewer output shape (review-checklist); the `security-reviewer` agent (security-checklist); the merge-before-close rule (close-when-merged)
- Produces: none

### Task: security-design

**Check:** `templates/prd.md` Security is a threat model: boundaries, assets, STRIDE and misuse cases. prd.md requires it when discover recorded a trust boundary. The plan template and plan.md carry the wider risky list and the rule that misuse cases become Security tests. verify.md runs a secret scan that reports file, line and kind, never the value, plus the native audit and a lockfile diff review, with the skip and offline paths. config.json and cli.md name the `audit` key. A doc test asserts these.

**Interfaces**
- Consumes: section tags from security-checklist
- Produces: config key `audit` (a string command; when absent, verify detects the stack's native audit from the lockfile)

### Task: pane-polish

**Check:** the fallback and inline tip lines use `wrap="truncate-end"`. When a stop is approved in the pane while its chat question is open, a notice appears. The docked background follows the user's by-eye answer from the PR #1 reinstall (keep `transparent`, or remove it with a comment). Hooks tests pass.

**Interfaces**
- Consumes: the user's by-eye answer, passed in the brief
- Produces: none
