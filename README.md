# ai-workflow

A personal Claude Code marketplace. It holds **cairn**, an agent-driven software lifecycle that runs every plan through the same fixed sequence: discover → PRD → phased parallel plan → execute → verify → review → ship → learn. A script owns each plan's state, so you always know where a plan stands and can stop and resume at any point.

## Install

```
/plugin marketplace add /Users/jasonflenniken/Development/ai_workflow
/plugin install cairn@ai-workflow
```

In repos that use cairn, disable Superpowers and Compound Engineering. Their auto-triggering skills compete with cairn's.

## Use

| Command | What it does |
|---|---|
| `/cairn:next` | Does the one correct next thing for the plan you're in. This is the only command you need to remember. |
| `/cairn:new` | Starts a plan: its own branch and worktree, then the discovery interview. |
| `/cairn:product` | Product-level PRD and roadmap (`docs/sdlc/product/`). |
| `/cairn:status` | Shows every plan: where it is, what's done, what's next, what's blocked. |
| `/cairn:pause` / `/cairn:resume` | Stop at any point with a handoff note, and pick up exactly there later. |

The shell CLI is `plugins/cairn/bin/cairn`. It is on the Bash tool's PATH while the plugin is enabled. `cairn help` lists its commands, and `plugins/cairn/references/cli.md` is the contract.

## Develop

```
npm install
npm test          # CLI unit and lifecycle tests (node:test, runs the TypeScript directly)
npm run typecheck
npm run build     # bundles plugins/cairn/dist/cairn.mjs (committed)
claude plugin validate plugins/cairn
```

- The design and decision log is in `docs/design.md`.
- Upstream sources and their snapshot commits are in `plugins/cairn/UPSTREAM.md`.
- To rename the plugin, run `plugins/cairn/scripts/rename.sh <name>`.
