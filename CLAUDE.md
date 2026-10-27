# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A public Claude Code marketplace (`.claude-plugin/marketplace.json`, installed from GitHub as `jason-flenniken/cairn`) holding one plugin, **cairn** (`plugins/cairn/`): an agent-driven SDLC (Discover → PRD → Plan → Build → Check → Review → Ship → Learn) whose plan state is owned by a CLI rather than by prose. `README.md` is the user-facing spec; `plugins/cairn/references/cli.md` is the CLI contract (commands, stage-transition requirements, JSON shapes).

The repo dogfoods cairn: `.cairn/config.json` is cairn's own config for this repo, and `docs/cairn/plans/<date>-<slug>/` holds the plans (PRD, plan, decisions, RECORD) that built each version. Those plan folders and their `state.json` are written by the CLI; don't hand-edit them.

`sources/` is reference material borrowed from other projects, not part of the build. `graft/` is a gitignored code index.

## Commands

```
npm install
npm run build        # esbuild bundles cli/src/main.ts -> plugins/cairn/dist/cairn.mjs (committed)
npm run typecheck    # tsc -p plugins/cairn/cli
npm test             # CLI tests (node:test) then the mod's tests (claude plugin test)
claude plugin validate plugins/cairn
```

- Single CLI test file: `node --test plugins/cairn/cli/test/step.test.ts` (Node runs the `.ts` directly; add `--test-name-pattern '<regex>'` to narrow).
- Mod tests only: `npm run test:mod`. It copies `.claude-plugin/`, `hooks/`, and `types/` to a temp dir and runs `claude plugin test` there, so it needs the `claude` CLI on PATH.
- The full check cairn itself runs here is `npm run typecheck && npm test`.
- Run the CLI from source state: `node plugins/cairn/dist/cairn.mjs <cmd>` (or `cairn <cmd>` when the plugin is enabled). `cairn help` lists commands.

## Architecture

Four layers, and the boundaries between them are the point of the design:

1. **CLI** (`plugins/cairn/cli/src/`, TypeScript, zero runtime deps) is the *only* writer of a plan's `state.json`. `main.ts` parses args and dispatches; `commands.ts` re-exports the per-area handlers in `commands/` (stages, tasks, phase, evidence, suggest, pause, status, hooks, …). Each move between stages is validated and a missing proof throws `Refusal` with the exact fix. Key modules:
   - `locate.ts`: which plan a cwd belongs to. The current git branch decides (`feature/<slug>`, `fix/<slug>`, legacy `sdlc/<slug>`; task branches `task/<slug>/<task>`). It finds the plan's worktree via `git worktree list` and always reads/writes state there, falling back to `git show` for branches with no worktree. Plan folders are named `<local-date>-<slug>` (local date, not UTC; tests depend on this), with legacy undated folders still resolved. Plan files live under `docs/cairn/` and config under `.cairn/`; the old `docs/sdlc/` and `.sdlc/` are read as a fallback and moved by `cairn migrate`.
   - `state.ts`: load/save/log of `state.json`. `proof.ts`: human-approval proof (mod secret hash under `<git common dir>/cairn/`, heartbeat freshness, or `--human` terminal input).
   - `plan-parse.ts` / `commands/planload.ts`: parse the fenced YAML task block in `plan.md` into state (cycle check, scopes, requirement coverage). `ready.ts` computes which tasks can run in parallel without overlapping file scopes.
   - `cairn next` maps the current stage/substep to a file in `procedures/` and prints it; that is how agents learn what to do.
2. **Procedures / skills / agents** (markdown). `skills/*/SKILL.md` are thin slash-command wrappers that call `cairn` and follow the procedure `cairn next` names. `procedures/*.md` are the step-by-step instructions per stage. `agents/*.md` are the subagents (implementer, task-reviewer, branch-reviewer, …). `references/` holds the CLI contract, reporting rules, model tiers, and review/security checklists; `templates/` holds PRD/plan/record/config skeletons.
3. **Mod** (`plugins/cairn/hooks/`): a Claude Code module loaded via `hooks.json` → `register.tsx`, which only wires one-concern modules in `hooks/mod/`: the live pane (`pane.tsx`, `cards.tsx`, `bar.tsx`, …), agent activity tracking, menu approvals (`approve.ts`, holds the one-time secret in memory), pause/resume, heartbeat, and `guards.ts` (denies the model running `cairn approve`, setting `CAIRN_APPROVER`, or writing `state.json`/`.git/cairn/`). `hooks.json` also registers plain command hooks (`cairn hook session-start`, `cairn hook post-edit`). `hooks/NOTES.md` records engine limits and the exact guard/heartbeat/secret formats; read it before changing the mod. Types for the mod API are in `plugins/cairn/types/index.d.ts`.
4. **Bundle**: `plugins/cairn/dist/cairn.mjs` is committed and is what `bin/cairn` executes. After any change in `cli/src/`, run `npm run build` and commit the bundle with it. Changes in `hooks/` need `/reload-plugins` in a live session instead.

**Releasing**: people install from GitHub and get a cached copy keyed by `version` in `plugins/cairn/.claude-plugin/plugin.json`. A push that doesn't raise it never reaches them. `types/index.d.ts` must stay self-contained (no `import`): `claude plugin validate plugins/cairn` rejects it otherwise, and every `$.state` key the mod uses must be declared there.

## Testing conventions

- CLI tests import from `cli/src/` directly (not the bundle) and build throwaway git repos in a tmpdir; `lifecycle.test.ts` shows the pattern, including `asUser()` to simulate a mod approval. `test/plandir.ts`'s `pd()` resolves a plan folder under either naming scheme.
- Many tests assert on the **markdown** in `procedures/`, `skills/`, `templates/`, and `references/` (`*-doc.test.ts`, `procedures.test.ts`, `skills.test.ts`, `templates.test.ts`), including section headings like `## 5.` and specific phrases. Rewording a procedure can break tests; run `npm test` after doc edits and update the assertion deliberately when the wording change is intended.
- Mod tests use the `claude-code/testing` harness; `hooks/test/world.tsx` provides the shared fake CLI/git/fs and state builders.

## Writing for users

All user-facing text that procedures and agents produce follows `plugins/cairn/references/reporting.md`: outcome first, plain words, no internal ids or machinery nouns (envelope, gate, wave, dispatch…). Keep new procedure and agent prompts consistent with it.

`docs/design.md` is the original design history; some names in it (`sdlc/`, `slice`) predate the current `feature/`/`task/` naming, so trust the code and README where they differ.
