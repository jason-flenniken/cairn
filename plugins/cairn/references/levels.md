# Levels

Every feature plan has one level: MVP, Standard or Polished. It is the plan's `level` in `cairn status --json` (`levelLabel` is the display name). The fix track has no level. The level sets how much effort each stage spends; the floors below do not move with it.

## What each level does

| Stage | MVP | Standard | Polished |
|---|---|---|---|
| Discover | A short interview: goal, the one flow that must work, trust boundaries. No implications multi-select, no fresh-eyes challenge. | The full interview, plus a fresh-eyes challenge: an agent that never saw cairn's guess offers two or three approaches, the strongest objection, and unstated assumptions | The full interview, plus the challenge comparing three approaches with their cost and risk |
| PRD | Thin: Problem, Solution, Requirements with one-line checks, Non-goals. Security only when a trust boundary was recorded. No builder check. | The full PRD, plus a builder check: an agent that sees only the PRD restates it and lists what a builder would have to guess | Adds acceptance examples for conditional requirements |
| Plan | Few, large vertical tasks, usually one phase. No test cases. Risky tasks are still flagged. | The full plan | Test cases for every task, the failure modes each test pins, and a fresh-agent review of the plan before approval |
| Build | No per-task review except the security review the floor requires. Implementers run one tier lower. Red tests warn. | Every task reviewed; security review for risky tasks | Test-first for every task; the on-track check runs automatically at each phase end |
| Check | The floor scans. Red tests warn. | Tests, build, scans, acceptance checker | Adds app or browser verification; every requirement must be met and tested |
| Review | One light whole-branch review on a mid-tier model, plus the whole-branch security review | Opus branch review plus the security review | Adds a simplify pass and focused reviewers |
| Ship and Learn | A short record plus the hardening list; no learn step | The current ship and learn | Adds a captured learning that later plans read |

Standard is how cairn behaves with no level set. Polished items that cairn has no way to do yet (app or browser verification, the simplify pass, focused reviewers, the captured learning) take effect when that arrives; until then Polished runs Standard plus the items that exist.

## Floors at every level

- Check runs the secret scan and the dependency audit.
- A task that touches a trust boundary gets a security review at every level, including MVP. The signals are auth, money, deletes, migrations, a public API, untrusted input, personal data, a new dependency, model output, and shell commands or paths built from data. The plan flags such tasks as risky at every level.
- The whole-branch security review runs at every level.
- The PRD, plan and ship approvals stay.

## MVP and the hardening list

At MVP, red tests warn and never block. Anything MVP skips goes on the hardening list, not the ordinary follow-ups: untested areas, skipped reviews, failing test commands, and Optional and Nit review findings. File one with `cairn suggest add --kind hardening --where <glob> ...`. The list does not count toward the 5 open follow-ups a plan may close with. A Standard or Polished plan that starts on the same area is offered those items as scope.

## Fresh eyes and set-asides

The fresh-eyes challenge and the builder check feed the existing interview and the PRD stop; they add no stop of their own. Whatever cairn does not take to the user from either one is logged with `cairn decide "Set aside: ..."` and a one-line reason, and shown under the read-back card or at the PRD stop, so the user can pull it back.

## Changing the level

The level can go up at any stage before ship, and down only before any task has started. After the plan is created, only the user changes it. The model never runs `cairn level` on its own.

- When a raise would help (the MVP shortcuts are costing more than they save, or the user asks for more depth), suggest it. Read `modActive` from `cairn status --json`.
  - True: ask with AskUserQuestion. The question text includes `[cairn:level <slug>]`, with the plan slug from the status output. Options are exactly `MVP`, `Standard`, `Polished`, and optionally `Cancel`. The mod applies the pick.
  - False: the mod can't record a menu answer. Tell the user to run, in their own terminal, the full command `cd <planWorktree> && <plugin root>/bin/cairn level <level> --human` (real paths, so it runs as printed), then wait for them to say it's done.
- Check `cairn status --json` that `level` changed. A raise before any task starts clears the plan approval, so the plan is approved again. A raise later clears the Check and review results, so those stages run again at the new level.
- After a raise, list them with `cairn suggest list --open --json` and work on the entries with `hardening: true` whose `where` overlaps this plan's tasks (or use `--for <path>`); offer to work through them as a pass over the already-merged tasks, per the new level's rules.
