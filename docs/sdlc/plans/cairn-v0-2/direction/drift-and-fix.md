# Direction: phase "Drift check and fast lane"

Checked 2026-10-21 against prd.md and decisions.md. One read-only checker covered all twelve requirements the phase covers. Paths are under `plugins/cairn/`.

## Scorecard
| Requirement | Verdict | Evidence |
|---|---|---|
| FR-13 pause handoff and tip | partial | hooks/mod/pause.ts:68 writes "- None." instead of a placeholder for the agent |
| FR-14 Stop now | aligned | hooks/mod/pause.ts:131 |
| FR-18 direction check | aligned | procedures/direction.md:22 |
| FR-21 /cairn:direction | aligned | skills/direction/SKILL.md:10 |
| FR-23 fix track | aligned | cli/src/commands/plans.ts:18 |
| FR-24 repro | aligned | cli/src/commands/fix.ts:73 |
| FR-25 fix slice checks | aligned | cli/src/commands/slices.ts:127 |
| FR-26 fix review | aligned | cli/src/commands/stages.ts:160 |
| FR-27 fix record | aligned | cli/src/sections.ts:63 |
| FR-28 escalate | partial | cli/src/commands/planload.ts:20 does not enforce keeping the fix slice id |
| FR-30 clean start | partial | procedures/phase-end.md:61 offers it as a follow-up question after approval |
| FR-32 locked config | aligned | cli/src/commands/fix.ts:20 |

## Drift, worst first
1. **Escalate doesn't protect the fix slice in a later re-plan** (partial). Recommendation: Fix code, in the cli-polish slice alongside the re-plan progress fix.
2. **The fix procedure is behind the CLI** (unplanned): the CLI can reopen a finished fix slice from review, but procedures/fix.md:56 offers only escalate or hold. procedures/fix.md:58 also points to a Follow-ups section the fix record doesn't have. Recommendation: Fix code (procedure text).
3. **Clean start is a follow-up question, not a menu option** (partial). This is safe; the mod approves only on exact labels. Recommendation: Update spec (FR-30 wording); rename the option to "Start clean".
4. **Pause writes "None." for open questions** (partial). Recommendation: Fix code.

## Unplanned work
- Reopening the fix slice from review (cli/src/commands/slices.ts:59) was built at my request. The fix procedure still needs to use it.
- The pane has no label for the repro stage (hooks/mod/pane.tsx:27). It shows the raw name.

## Doc drift
- references/cli.md lacks repro, escalate, evidence phase, the fix track, and the new config keys. This is already in the dogfood-docs slice.
- cli/src/commands/plans.ts:42 still suggests EnterWorktree. FR-35 covers this.

## Not verified
- Live behavior of the pane and Stop now on a real surface. These are due at Verify.

```yaml cairn-direction
requirements:
  - { id: FR-13, verdict: partial, evidence: "plugins/cairn/hooks/mod/pause.ts:68", note: "writes None. instead of a placeholder" }
  - { id: FR-14, verdict: aligned, evidence: "plugins/cairn/hooks/mod/pause.ts:131" }
  - { id: FR-18, verdict: aligned, evidence: "plugins/cairn/procedures/direction.md:22" }
  - { id: FR-21, verdict: aligned, evidence: "plugins/cairn/skills/direction/SKILL.md:10" }
  - { id: FR-23, verdict: aligned, evidence: "plugins/cairn/cli/src/commands/plans.ts:18" }
  - { id: FR-24, verdict: aligned, evidence: "plugins/cairn/cli/src/commands/fix.ts:73" }
  - { id: FR-25, verdict: aligned, evidence: "plugins/cairn/cli/src/commands/slices.ts:127" }
  - { id: FR-26, verdict: aligned, evidence: "plugins/cairn/cli/src/commands/stages.ts:160" }
  - { id: FR-27, verdict: aligned, evidence: "plugins/cairn/cli/src/sections.ts:63" }
  - { id: FR-28, verdict: partial, evidence: "plugins/cairn/cli/src/commands/planload.ts:20", note: "later re-plan may drop the fix slice id" }
  - { id: FR-30, verdict: partial, evidence: "plugins/cairn/procedures/phase-end.md:61", note: "clean start is a follow-up question" }
  - { id: FR-32, verdict: aligned, evidence: "plugins/cairn/cli/src/commands/fix.ts:20" }
unplanned:
  - { what: "reopen the fix slice from review", class: supporting, evidence: "plugins/cairn/cli/src/commands/slices.ts:59" }
  - { what: "pane lacks a repro stage label", class: unplanned, evidence: "plugins/cairn/hooks/mod/pane.tsx:27" }
nfr: []
```
