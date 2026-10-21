# Record: cairn v0.2

## Links
- PRD: `docs/sdlc/plans/cairn-v0-2/prd.md` (42 requirements)
- Plan: `docs/sdlc/plans/cairn-v0-2/plan.md` (4 phases, 19 slices)
- Decisions: `docs/sdlc/plans/cairn-v0-2/decisions.md` (25 entries)
- Drift reports: `docs/sdlc/plans/cairn-v0-2/direction/`
- Branch: `sdlc/cairn-v0-2`

## Why
In cairn v0.1 the model relayed approvals itself, and plan state was visible only on request. Pausing needed an agent turn, the phase check couldn't block anything, and bugs had no lightweight path. v0.2 makes approvals provably yours, puts the plan in a live pane, makes pausing instant and resuming cheap, adds a drift check the CLI scores, and adds a repro-first fast lane.

## What was built
- **Phase 1, proof of the user.**
  - Approvals and overrides now need proof they came from you: your exact menu answer read by the mod, or a run in your own terminal.
  - The model can't approve, override, or write plan state.
  - The CLI was split into modules first, so the later work could run in parallel.
- **Phase 2, what you see.** A live side pane (`/cairn-pane`) and a status line. The pane has Approve, Pause, Stop now, Resume, and Status buttons. The CLI computes the drift verdict.
- **Phase 3, drift and the fast lane.**
  - Each phase end runs a full drift check: the procedure, the `direction-checker` agent, and `/cairn:direction`.
  - `/cairn:fix` gives bugs a repro-first track with a file limit, escalation to a full plan, reopening from review, and a locked command config.
  - Stop now records the pause itself.
- **Phase 4, dogfood fixes.**
  - Long text can be passed through `--file` and `--note-file`.
  - Each `cairn` subcommand is pre-approved by name, except `repro`.
  - The orchestrator never locks itself into a worktree.
  - Drift is checked from the git diff at slice done.
  - Re-plans keep slice progress, requirement ids are strict, and refactor-only slices are allowed.
  - Git's background maintenance is off in CLI git calls.
  - Three guard false positives are fixed, and the docs are rewritten.

## How it works
- **The CLI** is still the only writer of state. It now checks human proof. The mod keeps a random secret in memory and puts only its SHA-256 on disk; the CLI accepts it once and deletes the hash. Without the mod, `--human` in a real terminal asks you to type the plan name.
- **The mod** (`hooks/register.tsx` plus `hooks/mod/*`) watches AskUserQuestion answers tagged `[cairn:approve …]` and `[cairn:override …]`. It runs the approval, or runs your override command, itself. Its guards block the model's own approval calls and writes to state. It draws the pane, writes a heartbeat every 2 s (`modActive`), and handles pause, Stop now, and resume.
- **Drift:** each phase end writes a scorecard. `cairn evidence phase` computes green, yellow, or red from it. A red verdict, or code changed since the verdict, blocks approving the phase.

## Evidence
- Tests: typecheck clean, 151 CLI tests and the mod tests pass, and `claude plugin validate` passes.
- Live, in this session:
  - Phases 3 and 4 and two re-plans were approved by the mod from your menu answers (logged `source: mod`).
  - The mod ran an override for you.
  - The guards blocked the model's state reads, which also exposed three false positives that were then fixed.
  - The pane opened.
- Drift verdicts: Phase 3 yellow, Phase 4 yellow, with partials covered in Follow-ups. Phases 1 and 2 were approved under v0.1 rules.

## Deviations
- Mod commands use "-" (`/cairn-pane`, `/cairn-approve`), because the engine forbids ":" in names a mod registers.
- The secret is hashed on disk and overrides are run by the mod (decision 14). There are no grant files.
- The Bash guard denies writes, assignments, and access to `.git/cairn`, not every mention of those words. That was your choice after the broad rule blocked normal work.
- "Start clean" is a follow-up after the phase approval, not a menu option (FR-30).
- Two overrides were needed for the re-plan bug, before the CLI cleanup slice fixed it.
- During dogfooding the installed marketplace points at the plan worktree. It goes back to main at ship.

## Follow-ups
- Process weight: fewer gates, review rounds, and strict-label friction. This is the next round, by your request.
- Not yet confirmed live:
  - whether Claude Code honors the named `allowed-tools` list for `cd … && cairn …`
  - whether `/cairn-pause-mod` works mid-turn
  - pane rendering in desktop and VS Code
- Smaller items:
  - The test summary records the last count line (`fail 0`), not the pass count.
  - Drift re-flags a path you already reviewed.
  - `cairn resume` still mentions EnterWorktree.
  - A sandboxed repro timeout can't kill its child processes when setpgid is refused.
- PRD wording to refresh: FR-03, FR-01 ("rotates"), and FR-30.
