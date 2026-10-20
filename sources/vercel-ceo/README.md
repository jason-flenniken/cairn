# Vercel CEO's 7 AI-agent tips: resource pack

The commands, agents and hook from the video. Copy `.claude/` into the root of your project. The agents work out your app's details from your `CLAUDE.md` and `specs/`. The only thing to fill in is the `{{…}}` placeholders in `/triage`: your support inbox and Sentry project.

```
.claude/commands/direction.md      /direction: is the build still on plan?      (tip 2)
.claude/agents/breaker.md          Tries to break the app on purpose            (tip 5)
.claude/agents/first-timer.md      Blind first-time-user test in a browser      (tip 6)
.claude/hooks/first-timer-bash.mjs Keeps first-timer from reading your code     (tip 6)
.claude/agents/pathrunner.md       Writes + runs critical-path tests, reports   (tip 6)
.claude/commands/triage.md         /triage: sort customer feedback and errors   (tip 7)
```

The agents and commands expect your project to have a `specs/` folder (a `prd.md` plus one requirements doc per feature in `specs/features/`) and a `CLAUDE.md` with a **MUST NOT TRADE OFF** section (tip 4).

Claude Code picks up new files in `.claude/` automatically. If a command or agent doesn't show up, restart Claude Code.

## /direction (tip 2)

Reads every requirements doc in `specs/` (one subagent per group) and checks the code still matches the plan. It also finds work that no plan covers. You get a 🟢/🟡/🔴 verdict, a scorecard and next steps.

```
/direction            # everything
/direction FR-03      # one feature
/direction changed    # only uncommitted changes
```

## breaker (tip 5)

> Run the breaker agent.

The agent backs up your data, then attacks the local app with races, double submits, bad input, authorization bypasses and latency under bursts. It writes `breaker-report.md`. Then:

> Fix the findings in breaker-report.md, then run breaker again to confirm none come back.

## first-timer (tip 6)

> Run the first-timer agent.

This agent uses the app in a real browser with no knowledge of it. The hook blocks it from reading code, specs or docs, and blocks every command except starting and checking the app. If your app isn't `npm run dev` on port 3000, edit the settings at the top of the hook and the agent's command list.

## pathrunner (tip 6)

> Run the pathrunner agent.

On the first run, pathrunner reads your `specs/` and writes `e2e/critical-paths.mjs`: one browser test per journey a customer must complete. It then runs the tests on a throwaway copy of your data and reports pass/fail, step timings and page speed against your targets. Results go to `e2e/results/latest.json`. Later runs reuse the same suite.

## /triage (tip 7)

Connect your feedback sources as MCP servers. For example:

```bash
claude mcp add --transport http sentry https://mcp.sentry.dev/mcp   # production errors
```

For the support inbox, use the Gmail connector in Claude, or any Gmail MCP server. Then:

```
/triage 24h
```

Claude groups duplicates and fixes what is clearly broken, with a repro and a check. It drafts replies for anything that needs your judgment.
