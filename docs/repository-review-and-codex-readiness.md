# Cairn repository review and Codex readiness

Reviewed 2026-11-13 against `caa69cd` (plugin 0.16.0). Assessment covers CLI architecture and major command paths, scheduling, persistence, approval proof, Claude integration, workflow instructions, Linear delivery, and tests. This is a repository review, not a certification of every function or a live multi-agent production run. No implementation changes were made.

## Overall judgment

Cairn has a strong central idea: make workflow progress a program with explicit state and refusals, while letting models perform the judgment-heavy work. The CLI is substantially reusable in Codex. The complete plugin is **not Codex-ready as shipped**: its orchestration, approval UI, guards, telemetry, and model selection assume Claude Code.

Recommend retaining one workflow core and adding a small Codex adapter. Start with CLI/status output and explicit human approvals; defer visual parity. Do not fork the entire set of procedures or rewrite the state machine. Approval integrity requires its own design decision before claiming equivalent guarantees.

## What is good

- **Executable workflow rules.** `commands/stages.ts`, `shared.ts`, and `commands/planload.ts` check actual state, document coverage and evidence. Refusals include recovery instructions. This is more dependable than asking a model to remember a checklist.
- **Useful separation.** CLI owns progress; procedures describe work; agents specialize; the mod provides interaction. `cairn next --json` and persisted briefs/reports provide an unusually good porting seam.
- **Git-aware execution.** Branch/worktree resolution, task scope checks, merged-branch verification, stacked plans and ship-head matching reflect real development failure cases. Git commands generally use argument arrays.
- **Intentional concurrency.** `readySet` handles dependencies, file-scope overlap, phase overlap and builder capacity. One orchestrator performs merges, limiting integration races during normal use.
- **Quality proportional to work.** MVP/Standard/Polished, risk-sensitive security review, a small-fix lane and bounded fix attempts help avoid applying the largest process to every change.
- **Independent assessment.** Fresh-eyes checks and restrictions on reviewers reading implementation narratives reduce anchoring. They cannot prove correctness, but the separation is worthwhile.
- **Durable continuity.** Decisions, records, resume instructions and follow-ups survive individual sessions. Memory is kept readable rather than hidden in an opaque service.
- **Defensive approval implementation.** One-use hashes, constant-time comparison, symlink checks and removal of approval secrets from child environments are thoughtful controls within the intended runtime.
- **Serious tests and operational notes.** Tests exercise temporary Git repositories and mod behavior, not just helpers. `hooks/NOTES.md` documents actual host constraints and distinguishes live probes from assumptions.
- **Linear failures do not stop local development.** The outbox and claim mechanism are a sound foundation even though delivery recovery needs strengthening.

## Findings and improvements

### High: state persistence can leave unreadable progress after interruption

Evidence: `cli/src/state.ts:30` calls `writeText`; `cli/src/util.ts:23` uses direct `writeFileSync`. State and STATUS are written separately. Several status readers do not acquire the mutation lock.

A process termination or write failure during truncation/rewrite can leave partial JSON; a concurrent reader can encounter that partial file. A lock around writers does not make a file replacement atomic. This is a source-confirmed failure window; no destructive crash test was performed.

**Change:** write a temporary file in the same directory and rename it over state.json. Treat STATUS as regenerable output. Validate state before replacement and retain a documented recovery path. Add interrupted-write and concurrent-reader tests.

### High for Codex parity: a TTY is not proof of a human

Evidence: `cli/src/proof.ts:21–40` and `humanProof` accept terminal input when stdin/stdout are TTYs and the typed slug matches. `hooks/mod/guards.ts` explicitly tries to block pseudo-terminal wrappers.

Codex exposes PTY execution and stdin interaction in this session. Thus the CLI alone cannot distinguish a human terminal from an agent-controlled one. Likewise, a process with write access to the approval-hash directory can manufacture its own proof. The shell deny-list is explicitly best-effort and does not establish OS-level separation.

**Change:** document the trust model accurately. For equivalent enforced approvals, use a trusted host-mediated approval path or a separate authority whose credentials and state the agent cannot modify. Bind authorization to plan, operation and approved content/version. A manual-terminal workflow can be an explicitly documented cooperative baseline, but is not an adversarial security boundary. No approval bypass was executed against this repository.

### Medium: malformed task YAML escapes validation

Evidence: `cli/src/plan-parse.ts:52–53` records that tasks is not an array, then still iterates it. Reproduced by calling `parsePlan` with `phases: [{ id: one, tasks: {} }]` in its YAML block: `object is not iterable`.

**Change:** return/continue after the invalid shape; iterate only a validated array. Reject invalid list types consistently, including blocked_by, rather than silently treating malformed values as empty. Test objects, strings, nulls and wrong element types. Expected result is actionable validation problems, not an exception.

### Medium: critical-path reporting depends on declaration order

Evidence: `cli/src/ready.ts:72`, `criticalPath`, discards dependencies not yet present in `best`. `parsePlan` allows dependencies on later-listed tasks in the same phase.

Reproduced with simple tasks listed as consumer(blockedBy producer), then producer: reported chain is only consumer, weight 1, instead of producer → consumer, weight 2. This affects planning/reporting; `readySet` separately checks completion and is not shown to start these tasks incorrectly.

**Change:** topologically order the graph before longest-path computation, or memoize traversal over validated dependencies. Test reversed declaration order and phase barriers.

### Medium: Linear retries can duplicate successful remote writes

Evidence: `commands/linear.ts:320` claims entries for ten minutes; `linear.ts` stores local dedupe keys; `procedures/linear-sync.md:23–35` sends remotely and only then records `linear sent`.

If creation succeeds and the sender crashes before acknowledgement, a later sender retries the same create/comment. A sender that exceeds the lease can overlap its replacement. Local dedupe prevents duplicate queue entries, not duplicate remote effects. This is a source-confirmed delivery window, not a live Linear reproduction.

**Change:** use remote idempotency where supported; otherwise add a stable operation marker and reconcile uncertain outcomes before resending non-idempotent operations. Add claim tokens and renewal/ownership checks. Test successful remote creation followed by lost local acknowledgement and lease expiry. Avoid documentation promises that retries can never duplicate an issue.

### Medium: lock recovery can evict a live writer

Evidence: `util.ts:46`, `withLock`, removes a lock older than 30 seconds without owner liveness or renewal. An original holder's finally block can subsequently remove another holder's replacement lock.

Most callbacks are short and slow tests are deliberately outside the lock, which reduces exposure. Git/worktree operations still occur inside some callbacks, including task start, so elapsed time alone is not proof of abandonment.

**Change:** track ownership and validate it before release; use safe stale-owner recovery. Test a holder exceeding the stale interval. Also serialize Git integration separately from state mutation: `mutate` commits after releasing its lock and task merges run outside it. Normal single-orchestrator operation mitigates this, but two sessions on one plan need explicit handling.

### Medium: test results can be attributed to a moving checkout

Evidence: `commands/tasks.ts:125` gathers state and Git facts, runs tests outside the lock, then reads HEAD and records completion. `commands/merge.ts` similarly records a head after its test run.

Another process changing the checkout during the run can cause passing results to be associated with a commit that was not the original test input. Existing single-merger instructions reduce the likelihood; they do not exclude a second session.

**Change:** capture HEAD and worktree cleanliness before and after execution, refuse changed inputs, and serialize integration. For stronger provenance, test a fixed detached checkout. Add a test that changes HEAD during a controlled test command.

### Lower priority: validation and maintainability

- `loadState` checks schema version but not the complete runtime shape; `parseState` does not check the version. Malformed or future state can produce incidental exceptions. Add a small boundary validator and explicit migration policy; no need for a general schema framework.
- `runTests` has no timeout. Hung project tests can stall completion indefinitely. Add configurable timeout/cancellation and report interruption separately from a failed assertion.
- Test scripts run TypeScript files directly, while README's Node 20+ statement describes the bundled CLI. Document a distinct development Node requirement and test minimum supported runtime against the bundle.
- No `.github` CI configuration was present. Add repeatable typecheck, CLI tests, bundle freshness and packaging checks; run mod checks where the required Claude environment exists.
- Many tests assert exact prose. Keep assertions for operational contracts, but avoid unnecessary wording constraints. Add scenario evaluations for discovery quality, review independence, recovery and actual end-to-end agent behavior.
- The scope has grown beyond a small workflow: Linear planning, board rendering, telemetry, migration and memory all add maintenance cost. Preserve opt-in integrations; prioritize state reliability over further UI expansion.

## Codex compatibility map

| Area | Current implementation | Required work |
|---|---|---|
| Core CLI | Bundled Node CLI and JSON results | Reuse; smoke-test outside Claude and provide reliable executable resolution |
| Packaging | Claude marketplace and `.claude-plugin/plugin.json` | Add validated OpenAI packaging/distribution; keep Claude package working |
| Skills | Thin wrappers using Claude paths, tools and arguments | Resolve installed root, invocation, arguments and supporting files on the chosen Codex surface |
| Procedures | Agent, SendMessage, AskUserQuestion, background execution | Map to actual host capabilities; preserve pause, waiting and reviewer isolation |
| Model policy | `haiku/sonnet/opus` in builder, parser and prompts | Separate role/effort intent from provider model identifiers; support existing saved plans |
| Agent definitions | Claude frontmatter and named agents | Translate roles into supported Codex configuration or explicit isolated agent instructions |
| Approval UI | Claude `$.ui`, tagged questions and mod secret | New trusted approval integration; no assumed equivalence to shell permission approval |
| Guards | Claude `tool.call` module and path/shell inspection | Codex command-hook adapter plus tested failure behavior and honest enforcement limits |
| Session context | SessionStart command hook | Reuse core context generation; verify event payload/output and compaction/fork behavior |
| Edit drift | Expects `file_path` / `notebook_path` | Handle patch commands, all affected files, renames and deletes; keep Git-based final checks |
| Pane/telemetry | Claude TSX mod, atoms, UI events and usage | No verified drop-in equivalent; CLI/status first, separate UI later if justified |
| Worktrees | `.claude/worktrees`, shared Git metadata | Configurable location, sandbox access checks, clear repair instructions |
| Linear | Queued operations plus MCP sender | Discover tools/schemas, validate permissions and delivery recovery per host |
| Testing | Node tests plus `claude plugin test` | Add Codex installation, hook and end-to-end acceptance coverage |

## Current Codex facts checked

Installed CLI reports `codex-cli 0.167.2`; its help includes plugin management, hooks trust controls, worktrees and sandbox settings. Context7 tools were unavailable, so current official documentation was used after checking the local CLI.

OpenAI supports plugin packaging and command hooks. Hook environments include PLUGIN_ROOT and a CLAUDE_PLUGIN_ROOT compatibility alias; that does **not** establish substitution inside every Markdown instruction. Plugin hooks require trust. See [package documentation](https://developers.openai.com/plugins/build/plugins).

Codex hook payloads differ in relevant ways: apply_patch arrives as command text, not a single file_path. Hook errors/timeouts may allow execution, and stdin interaction does not repeat PreToolUse. Hooks are guardrails, not complete enforcement. See [hook documentation](https://learn.chatgpt.com/docs/hooks).

Current Claude-plugin migration guidance distinguishes manual hook-based distribution from public-directory submission, where lifecycle hooks must be removed. It also calls for converting reusable commands/agent behavior to skills. Choose distribution deliberately; do not remove required controls merely to qualify for a directory. See [migration guidance](https://developers.openai.com/plugins/guides/submit-claude-plugin).

No evidence found that Codex runs Claude's `claude-code` TSX mod API. This review does not assert that Codex lacks plugins or hooks; it finds that Cairn's particular mod requires replacement. Desktop, CLI and hosted environments should have separate support claims.

## Recommended implementation backlog

### First: establish a working CLI-based Codex edition

- [ ] Select the first supported surface and minimum version, preferably local Codex CLI.
- [ ] Decide cooperative manual approval versus enforced approval authority; document guarantee and limitations.
- [ ] Fix persistence and the reproduced parser/scheduler defects before expanding supported hosts.
- [ ] Add packaging and a root-resolving CLI launcher; test an installed copy, not only this checkout.
- [ ] Add Codex wrappers with explicit capability checks and clear unsupported-operation errors.
- [ ] Replace provider-specific model routing without changing saved-plan meaning.
- [ ] Preserve fresh reviewer context, task worktrees and serial merges; support sequential fallback when delegation is unavailable.
- [ ] Expose status, pending approvals and pause/resume through the CLI; make pane absence explicit.

### Then: integrate runtime behavior

- [ ] Adapt session and edit hooks using recorded Codex fixtures, including multi-file patches.
- [ ] Test trust-disabled, timeout, malformed-output and missing-hook behavior.
- [ ] Implement the chosen approval path and test replay, stale document, wrong plan and agent-controlled PTY cases.
- [ ] Make worktree/common-Git-directory permissions diagnosable without recommending unrestricted sandbox bypass.
- [ ] Adapt optional Linear tools and resolve uncertain remote delivery.
- [ ] Add lifecycle integration tests and cross-host resume tests.

### Release acceptance

A clean installation must complete a small feature and a bug fix, refuse unapproved transitions, survive restart/compaction, retain independent review, detect scope drift, integrate task branches, run configured checks and produce a record. Exercise concurrent task updates, interrupted writes, stale locks, merge conflicts and missing dependencies. Verify no changes to the existing Claude workflow. Claim feature parity only for features actually exercised in the target runtime.

No effort estimate is supplied: packaging and wrappers are bounded work; trustworthy approval integration and UI parity depend on runtime capabilities that need a focused prototype.

## Verification

Validation results are recorded below after the review runs finish. Additional direct probes reproduced malformed-task validation failure and declaration-order-sensitive critical-path reporting. No Linear writes, commits, plugin installation or approval actions were performed. Existing untracked `.nodeterm/` was left untouched. Graft was unavailable on PATH; the referenced user RTK.md path did not exist.

Completed checks:

- `npm run typecheck`: passed (CLI TypeScript scope).
- CLI test suite: **492 passed, 0 failed**.
- `npm run test:mod`: **661 passed, 0 failed**, across 18 files.
- `claude plugin validate plugins/cairn`: passed **with warnings**, including TypeScript extension-import diagnostics, a number/string diagnostic in `hooks/mod/cards.tsx:96`, test typing diagnostics and missing listing icon. These need triage; passing CLI typecheck is not evidence of clean mod typing.
- Rebuilt bundle into `/tmp` with the repository build arguments: byte-identical to committed `dist/cairn.mjs`.
- Direct source probes: both defects described above reproduced despite the passing suite.
- Runtime used: Node v26.7.0. Node 20 compatibility and live Codex installation/agent lifecycle were not exercised.
