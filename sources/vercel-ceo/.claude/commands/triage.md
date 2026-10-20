---
description: Read new customer feedback and production errors, fix the clear-cut bugs, and hand the judgment calls to me
argument-hint: "[since: 24h | 7d | YYYY-MM-DD]"
---

<!--
Tip 7. Needs MCP servers for your feedback sources, e.g. Gmail (support inbox) and Sentry (errors).
Edit the Sources list to match what you've connected.
-->

# /triage: what are customers telling us?

Window: `$ARGUMENTS` (default: since the last triage, or 24h).

## 1. Collect

Pull every new item in the window from each connected source. If a source isn't connected, say so and continue with the rest.

- **Support email** (Gmail MCP): messages to {{support@yourapp.com}} or labelled {{Support}}. Include screenshots and attachments.
- **Errors** (Sentry MCP): new and regressed issues in project {{project}}, with event count, users affected and first seen.
- {{Other: Slack channel, Intercom, GitHub issues, app store reviews}}

Group duplicates: the same error or complaint from several places is one item with several reports.

## 2. Sort

Read `CLAUDE.md` (MUST NOT TRADE OFF) and the relevant RD in `specs/features/` for each item, then put it in exactly one bucket:

| Bucket | Meaning | Examples |
|---|---|---|
| 🔥 **Fix now** | Clearly broken, spec says what correct is, fix is contained | Payment fails, button does nothing, 500 on a page, error in Sentry with a stack trace |
| 🧭 **Needs you** | Needs a product decision or a conversation with the customer | "I'm confused by…", feature requests, anything touching a PRD non goal or open question |
| 📝 **Spec gap** | Behaviour is undefined in the specs | Edge case no RD covers |
| 🗑 **No action** | Spam, already fixed, works as specified | |

Anything touching security, data loss or another customer's data is 🔥 and goes first, but only fix it if the fix is obvious; otherwise flag it at the top of the report.

## 3. Act

- **🔥 Fix now**: reproduce first (a failing test or a browser repro), fix the root cause, run the project's build and lint (see `CLAUDE.md`), and re-run the repro. One change per item. Don't push or deploy; leave that to me.
- **🧭 Needs you**: don't change code. Draft a short reply to the customer that asks the one question that would clear it up. Don't send it.
- **📝 Spec gap**: propose the RD change; don't write code.

## 4. Report

```
## Triage <window>: <n> items · 🔥 <n> · 🧭 <n> · 📝 <n> · 🗑 <n>

### 🔥 Fixed (verify and ship)
- <title> · <source + link> · <customers affected> · fix: `path:line` · repro: <test/steps> · time from report to fix: <h>

### 🔥 Not fixed (blocked)
- <title> · why blocked

### 🧭 Needs you
- <title> · <who> · what they said (quote) · my read · draft reply below

### 📝 Spec gaps
- <title> · proposed RD change

### Response times
Oldest unanswered report: <age> · median report-to-fix this window: <h>
```
