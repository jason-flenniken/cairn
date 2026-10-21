# Direction: phase "Dogfood fixes"

Checked 2026-10-21 by three read-only checkers, in parallel, over the 15 requirements this phase covers. Paths are under `plugins/cairn/`.

## Scorecard
| Requirement | Verdict | Evidence |
|---|---|---|
| FR-03 Bash guard | partial | hooks/mod/guards.ts:32 denies writes, assignments, and access to `.git/cairn`, not any mention |
| FR-09 pane content | aligned | hooks/mod/pane.tsx:242 |
| FR-13 pause handoff | aligned | hooks/mod/pause.ts:109 |
| FR-19 verdict refusals | aligned | cli/src/commands/evidence.ts:9 |
| FR-28 escalate | aligned | cli/src/commands/fix.ts:100 |
| FR-29 file input | aligned | cli/src/commands/plans.ts:57 |
| FR-31 named pre-approvals | aligned | skills/execute/SKILL.md:5 |
| FR-35 no worktree lock | aligned | procedures/new.md:32 |
| FR-36 test summary | aligned | cli/src/shared.ts:103 |
| FR-37 approval sources | aligned | cli/src/render.ts:80 |
| FR-38 documented formats | aligned | references/cli.md:19 |
| FR-39 strict ids | aligned | cli/src/plan-parse.ts:58 |
| FR-40 prefactor slices | aligned | cli/src/plan-parse.ts:26 |
| FR-41 drift from git diff | aligned | cli/src/commands/slices.ts:131 |
| FR-42 re-plan keeps progress | aligned | cli/src/plan-parse.ts:91 |

## Drift, worst first
1. **The guard rule is narrower than the FR-03 text** (partial). The code denies what writes the state file, assigns the secret variable, or reaches `.git/cairn`. Searches that merely mention those words are allowed. That was the user's choice after the broad rule blocked normal work, and the CLI's proof check backs it. Recommendation: Update spec. FR-03 should say "writes, assigns, or reaches", not "mentions".
2. **The PRD wording is stale in three places.** FR-30 still says "Approve and start clean" (the procedure has "Start clean" after approval). FR-01 says the secret "rotates" (the CLI deletes the hash on a match, and the mod writes a new pair). The guard does not catch `dist/` scripts other than `cairn.mjs`. Recommendation: Update spec at Verify.

## Unplanned work
- Git auto-maintenance is off in every CLI git call (`cli/src/git.ts:9`). This was the flaky-test fix. Supporting.
- Atomic claim of the secret hash by rename (`cli/src/proof.ts:58`). Supporting.
- The pane has a Status button (`hooks/mod/pane.tsx:239`). Unplanned, but it's in FR-12.

## Doc drift
- `references/cli.md` doesn't describe the strict-id or prefactor rules under `plan load`. It is a gap, not a contradiction.
- `hooks/NOTES.md` and `cli.md` describe secret replacement in different words.

## Not verified
- Whether Claude Code's permission matcher accepts `Bash(cairn status:*)` for `cd <worktree> && cairn status`. This is a Verify item: if it doesn't, cairn calls prompt.
- Whether `/cairn-pause-mod` works mid-turn without `immediate`. This is a Verify item.

```yaml cairn-direction
requirements:
  - { id: FR-03, verdict: partial, evidence: "plugins/cairn/hooks/mod/guards.ts:32", note: "denies writes, assignments, and reach; not any mention" }
  - { id: FR-09, verdict: aligned, evidence: "plugins/cairn/hooks/mod/pane.tsx:242" }
  - { id: FR-13, verdict: aligned, evidence: "plugins/cairn/hooks/mod/pause.ts:109" }
  - { id: FR-19, verdict: aligned, evidence: "plugins/cairn/cli/src/commands/evidence.ts:9" }
  - { id: FR-28, verdict: aligned, evidence: "plugins/cairn/cli/src/commands/fix.ts:100" }
  - { id: FR-29, verdict: aligned, evidence: "plugins/cairn/cli/src/commands/plans.ts:57" }
  - { id: FR-31, verdict: aligned, evidence: "plugins/cairn/skills/execute/SKILL.md:5" }
  - { id: FR-35, verdict: aligned, evidence: "plugins/cairn/procedures/new.md:32" }
  - { id: FR-36, verdict: aligned, evidence: "plugins/cairn/cli/src/shared.ts:103" }
  - { id: FR-37, verdict: aligned, evidence: "plugins/cairn/cli/src/render.ts:80" }
  - { id: FR-38, verdict: aligned, evidence: "plugins/cairn/references/cli.md:19" }
  - { id: FR-39, verdict: aligned, evidence: "plugins/cairn/cli/src/plan-parse.ts:58" }
  - { id: FR-40, verdict: aligned, evidence: "plugins/cairn/cli/src/plan-parse.ts:26" }
  - { id: FR-41, verdict: aligned, evidence: "plugins/cairn/cli/src/commands/slices.ts:131" }
  - { id: FR-42, verdict: aligned, evidence: "plugins/cairn/cli/src/plan-parse.ts:91" }
unplanned:
  - { what: "git auto-maintenance disabled in CLI git calls", class: supporting, evidence: "plugins/cairn/cli/src/git.ts:9" }
  - { what: "atomic claim of the secret hash", class: supporting, evidence: "plugins/cairn/cli/src/proof.ts:58" }
nfr:
  - { id: NFR-02, verdict: aligned, evidence: "plugins/cairn/hooks/mod/guards.ts:439" }
  - { id: NFR-07, verdict: aligned, evidence: "plugins/cairn/hooks/mod/pause.ts:211" }
```
