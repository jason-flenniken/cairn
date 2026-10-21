# ai-workflow

A personal Claude Code marketplace. It holds one plugin, **cairn**, an agent-driven software development lifecycle.

cairn takes a feature from an idea to a shipped, recorded change in the same fixed steps every time:

```
Discover → PRD → Plan → Build → Check → Review → Ship → Learn
```

Agents do the work. You make the calls that matter: approving the PRD, the plan, and the ship.

A small CLI owns each plan's state, so you always know three things: where a plan stands, what's done, and what's next. You can stop at any point and pick up exactly where you left off, in a new session if you like.

## Why it exists

Workflow plugins such as Compound Engineering and Superpowers describe their stages in prose that the model may or may not follow. That leads to four problems:

- Long plans drift.
- Steps get skipped.
- There's no single view of where a plan stands.
- Every run costs a lot of tests, reviews, and gates, whether or not the change needs them.

cairn fixes this in four ways:

- **A script owns the state.** The stage, phases, tasks, approvals, and test results live in a `state.json` that only the `cairn` CLI writes. The CLI refuses a move when its proof is missing, and it names the fix.
- **The minimum by default.** Every task gets tests for its core logic, and the full test suite runs before each merge. Only **risky** tasks get thorough tests and a reviewer: auth, money, deleting data, migrations, public APIs. Everything else worth doing later goes into a list of **recommended follow-ups**, and cairn offers them back when you next touch the same code.
- **You can see it working.** A live pane beside the chat shows a card for every running agent: what it's doing, how long it's taken, and roughly how long is left.
- **Parallel, isolated work.** Each plan runs on its own branch and worktree, and each task on its own branch and worktree. Tasks that don't touch the same files run in parallel, up to 3 at a time.

## Requirements

- Claude Code **v2.1.287 or later**, for the mod that powers the pane, menu approvals, and pause.
- Node.js **20+**. The CLI is a single bundled file with no dependencies.
- Git. Plans live on branches and worktrees.
- For the full-height side pane: Claude Code's fullscreen layout, `"tui": "fullscreen"` in `~/.claude/settings.json`, or run `/tui fullscreen` once. In the normal layout the pane sits above the prompt as a compact summary.

## Install

```
/plugin marketplace add /Users/jasonflenniken/Development/ai_workflow
/plugin install cairn@ai-workflow
```

Then run `/reload-plugins`, or start a new session.

In any repo where you use cairn, turn off Superpowers and Compound Engineering. Their skills trigger on their own and compete with cairn's. A project-level `.claude/settings.json` can do it:

```json
{
  "enabledPlugins": {
    "compound-engineering@compound-engineering-plugin": false,
    "superpowers@claude-plugins-official": false
  }
}
```

## Quick start

1. **Start a plan.** Inside the repo you want to work on, run:

   ```
   /cairn:new add a CSV export to the reports page
   ```

   cairn creates a branch (`feature/<slug>`) and a worktree for the plan. If the repo has no `.sdlc/config.json`, cairn detects your test and build commands from `package.json`, a `Makefile`, `pyproject.toml` and the like, asks you to confirm them, and commits the file. Then the discovery interview starts.
2. **Answer the interview.** It asks one question at a time, each with a recommended answer. Every answer is written to the plan's `decisions.md`.
3. **Approve the PRD**, then **approve the plan**, from the menu.
4. **Let it build.** Phases run on their own. Tasks run in parallel, get merged, and are tested. A phase that finishes with passing tests rolls straight into the next one.
5. **Approve the ship.** cairn writes a one-page record of what was built and why.

When you're unsure what to do, run **`/cairn:next`**. It does the one correct next thing for the plan you're in, and it's the only command you need to remember.

## Commands

| Command | What it does |
|---|---|
| `/cairn:next` | Does the next thing for the current plan, whatever stage it's in. |
| `/cairn:new <idea>` | Starts a plan: its branch and worktree, the repo config if missing, then the discovery interview. |
| `/cairn:status` | Shows every plan: stage, what's done, what's next, what's blocked, what's waiting on you. |
| `/cairn:pause` / `/cairn:resume` | Pauses cleanly with a handoff note, and later picks up exactly there. |
| `/cairn:fix <bug>` | The quick lane for one bug: failing repro first, then the fix, then a short record. |
| `/cairn:suggestions` | Lists recommended follow-ups from every plan. Turn one into a fix, add it to the current plan, or dismiss it. |
| `/cairn:direction` | An on-demand on-track check: compares the code to the PRD and reports green, yellow, or red per requirement. |
| `/cairn:product` | Writes the whole-app product PRD (`docs/sdlc/product/`) that every plan inherits. |
| `/cairn:discover`, `/cairn:prd`, `/cairn:plan`, `/cairn:execute` | Run one stage directly. `/cairn:next` normally picks these for you. |

The mod adds these commands, which run instantly without a Claude turn:

| Command | What it does |
|---|---|
| `/cairn-pane [on\|off]` | Shows or hides the live pane. With no word it toggles. Your choice sticks across sessions, and closing the pane by hand also turns it off. |
| `/cairn-approve [prd\|plan\|ship]` | Approves the stop the current plan is waiting on. |
| `/cairn-pause-mod` | Pauses once in-flight work reaches a safe point. |
| `/cairn-pause-now` | Stops the running turn and pauses right away. |
| `/cairn-resume-mod [plan]` | Resumes a paused plan, even after `/clear`. |

## The lifecycle

| Stage | What happens | Stops for you? |
|---|---|---|
| **Discover** | An interview, one decision at a time, covering users, the core flow, non-goals, and anything risky. Facts come from the codebase first, so the questions are only real decisions. | No |
| **PRD** | A short PRD: Problem, Solution, Requirements (each with a one-line check), Non-goals, Open questions. Unhappy paths, security, and performance sections appear only when they matter. | **Yes: approve the PRD** |
| **Plan** | The PRD is broken into phases of small vertical **tasks**. Each task lists its files, what it waits on, its size (which picks the model), and whether it's risky. Recommended follow-ups that touch the same files are offered as extra tasks. | **Yes: approve the plan** |
| **Build** | Ready tasks start in parallel, each in its own worktree with a fresh agent. Each one writes tests for its core logic. Risky tasks also get thorough tests and a reviewer, with at most two fix attempts before cairn asks you. Every task is merged and the full test suite runs. A finished phase continues on its own when tests pass. | Only if tests fail or something is blocked |
| **Check** | Tests and build, then one pass over the PRD's checks. A requirement that isn't met gets fixed. One that works but has no test becomes a recommended follow-up. | Only if something is broken |
| **Review** | One review of the whole branch. Blocking means a bug, a security hole, data loss, or an unmet requirement, and those are fixed in place. Everything else becomes a recommended follow-up. | Only if something is blocking |
| **Ship** | A one-page `RECORD.md`: links, why, what was built, how it works, follow-ups. | **Yes: approve the ship** |
| **Learn** | One optional question: anything worth remembering for next time? | No |

The `cairn` CLI checks each move between stages. If something is missing, such as an approval, a required PRD section, or a passing test run, it refuses and prints the exact fix. You can overrule a refusal from an **Override** menu, and every override is logged with its reason.

## The live pane

The pane opens on its own at the start of every session, docked on the right in fullscreen. Turn it off or on with `/cairn-pane`. From top to bottom:

```
cairn v0.3 · Build · phase 2 of 4
████████████░░░░░░░░ 9/19 tasks · ~40m left
NOW
┌ Build · CSV export ───────── sonnet ┐
│ ● working · 6m 12s                  │
│   editing src/reports/export.ts     │
│   14 steps                          │
└─────────────────────────────────────┘
┌ Main session ───────────────────────┐
│ ● running tests · 1m 40s            │
└─────────────────────────────────────┘
UP NEXT  Download button · Empty state (waits)
✓ 1 Data layer         4 tasks · 38m
◐ 2 Export             2 of 5
○ 3 Polish             0 of 3
12:03 merged Report query · 214 tests pass
[Pause] [Stop now] [Status]
```

- **Header:** the plan, the stage and phase, a progress bar, and a rough time left. The estimate uses how long tasks of each size have taken so far, split across the parallel slots.
- **Waiting on you:** a yellow box with an **Approve** button, shown only when a stop needs you.
- **NOW:** one card per running agent, showing its role and task, model, timer, current action, and step count. The **Main session** card shows what the orchestrator itself is doing, such as running tests or merging. A finished card turns green and briefly shows its time and token use.
- **Below the cards:** what's up next, the phases (finished ones fold to one line), recent events, and buttons for Pause, Stop now, Resume, and Status.

With no plan running, the pane still shows the agent cards and a line telling you how to start a plan. The status line under the prompt carries the short version: `cairn · Build 9/19 tasks · 3 working · ~40m left`.

## Recommended follow-ups

cairn keeps quality work it chose not to do now as a list of recommended follow-ups. Each one has an area (tests, security, perf, quality, ux, docs), the files it concerns, and where it came from. They're logged by:

- the planner, for tests it skipped on low-risk tasks
- implementers and task reviewers, for minor findings
- Check and Review, for things that work but are untested or could be better

They never block anything. They come back to you at these points:

- **During planning,** when a new plan touches the same files: *"I recommend adding tests for the export parser (noted during the reports plan)"*. You choose: add it as a task, later, or dismiss.
- **In the summary line** at the end of each phase and at ship.
- **In the pane,** as a count.
- **On demand,** with `/cairn:suggestions`.

## Approvals and overrides

Approvals have to come from you, not from the model. Only you can provide either form of proof:

- **Menu (the usual way).** cairn asks with a menu, and the mod records the approval when *you* choose an option starting with "Approve", or type something like "approve", "yes", or "lgtm". Answers the model fills in itself, dialogs that time out while you're away, and menus inside subagents never count. The pane's Approve button and `/cairn-approve` work the same way.
- **Terminal (fallback).** When the mod isn't running, run `cairn approve <prd|plan|ship> --human` in your own terminal and type the plan's name.

Behind the scenes, the mod holds a one-time secret in memory and the CLI checks it against a hash on disk, so a used secret can't be replayed. Guards also stop the model from running `cairn approve` or editing plan state directly.

## Pause and resume

- **Pause** (`/cairn:pause`, the pane's Pause button, or `/cairn-pause-mod`) lets running work reach a safe point, then writes `handoff.md`: what's in flight, open questions, the next action.
- **Stop now** stops the current turn immediately and records where each task was.
- **Resume** (`/cairn:resume`, or the pane's Resume button) gives a short recap and continues with only the unfinished steps. After a long pause, cairn suggests starting in a fresh session so you aren't paying for a stale context.

## The bug-fix lane

`/cairn:fix <bug>` is a short, tracked plan for one bug:

1. **Repro first.** cairn records a command that fails because of the bug, and refuses to go on until it has one.
2. **The fix.** One task, which must make the repro pass with tests green.
3. **Review,** only if the fix is risky.
4. **A short record** of at most 200 words, then ship.

If the fix grows past 8 files, or turns out to need new requirements, `cairn escalate` turns it into a full plan.

## Configuration

Each repo has `.sdlc/config.json`, which cairn creates the first time:

```json
{
  "setup": "npm ci",
  "test": "npm test",
  "build": "npm run build",
  "start": "npm run dev",
  "seed": "",
  "appTypes": ["web"],
  "maxParallel": 3,
  "resumeFreshAfterMinutes": 60,
  "autoCommit": true
}
```

| Key | Meaning |
|---|---|
| `setup` | Runs in every new plan or task worktree, for example to install dependencies. |
| `test` | The full test command. It runs before each task is marked done, and again at Check and close. |
| `build` | The build command, run at Check. |
| `start`, `seed`, `appTypes` | How to run the app, seed its data, and what kind of app it is (`web`, `expo`, `api`). These are recorded for checks that drive the running app; the lean defaults don't use them yet. |
| `maxParallel` | How many tasks run at once (default 3). |
| `resumeFreshAfterMinutes` | How long a pause counts as recent before resume suggests a fresh session (default 60). |
| `fixMaxFiles` | How many files a bug fix may touch before cairn suggests a full plan (default 8). |
| `reproTimeoutMinutes` | How long a bug repro may run (default 10). |

The `setup`, `test`, and `build` commands are locked when you approve the plan. If they change mid-plan, cairn asks you to re-approve.

## Where things live

| What | Where |
|---|---|
| A feature plan's branch | `feature/<slug>`, in a worktree under `.claude/worktrees/` (folder `feature-<slug>`) |
| A fix plan's branch | `fix/<slug>`, in a worktree under `.claude/worktrees/` (folder `fix-<slug>`) |
| A plan's documents | `docs/sdlc/plans/<slug>/` on the plan branch: `decisions.md`, `prd.md`, `plan.md`, `STATUS.md`, `handoff.md`, `RECORD.md`, `state.json` |
| A task's branch | `task/<slug>/<task>`, in its own worktree (folder: the plan folder plus `--<task>`, e.g. `feature-billing--cart-api`) |
| The product PRD | `docs/sdlc/product/` on main |
| Repo config | `.sdlc/config.json` |

When a plan ships, its branch merges back and its record lands on main with it.

## The CLI

Agents drive cairn through the `cairn` CLI. It is on the Bash tool's PATH while the plugin is enabled, and is also available as `node plugins/cairn/dist/cairn.mjs`. A few commands are handy by hand:

```
cairn status --all          # every plan, at a glance
cairn next                  # what to do now
cairn suggest list --open   # open recommended follow-ups
cairn approve plan --human  # approve from your own terminal
```

`cairn help` lists every command. The full contract is in `plugins/cairn/references/cli.md`: commands, what each move between stages requires, and JSON shapes.

## Developing cairn

```
npm install
npm run build        # bundles plugins/cairn/dist/cairn.mjs (committed)
npm run typecheck
npm test             # CLI tests (node:test) and the mod's tests (claude plugin test)
claude plugin validate plugins/cairn
```

```
plugins/cairn/
  cli/src/          the CLI (TypeScript), the only writer of plan state
  hooks/            the mod: register.tsx, plus mod/ (pane, agent tracking, approvals, pause, guards)
  procedures/       the step-by-step instructions for each stage; `cairn next` names the one to follow
  skills/           thin slash-command wrappers around the procedures
  agents/           implementer, task-reviewer, branch-reviewer, acceptance-checker, direction-checker, recorder
  templates/        PRD, plan, record, handoff, config
  references/       CLI contract, reporting rules (plain words, output style), model tiers
```

- Changes to `hooks/` take effect after `/reload-plugins`.
- Changes to `cli/src/` need `npm run build`.
- Engine limits found while building the mod are in `plugins/cairn/hooks/NOTES.md`.
- The design history is in `docs/design.md`, and each plan's record is in `docs/sdlc/plans/`.
- To rename the plugin: `plugins/cairn/scripts/rename.sh <name>`.

## Credits

cairn adapts ideas, prompts, and procedures from [Compound Engineering](https://github.com/everyinc/compound-engineering-plugin), [Superpowers](https://github.com/obra/superpowers), and [Matt Pocock's skills](https://github.com/mattpocock/skills), all MIT-licensed. Their notices are in `plugins/cairn/NOTICE`, and the upstream commits are in `plugins/cairn/UPSTREAM.md`.
