# Plan: <title>

> Source: prd.md. Each task is a thin, complete path through every layer, demoable on its own, and fits one context window.

## Goal
One sentence: what this plan builds.

## Architecture
Two to three sentences: approach, key components, data flow. Name the existing patterns to follow.

## Global constraints
Optional. Only values from the PRD that bind every task (versions, limits, naming). One line each.

- <constraint, exact value>

## Deferred requirements
Optional. FR ids deliberately not covered by this plan, each with a reason.

- FR-xx: <reason>

## Phases
Phases are demoable milestones. Tasks in one phase may run in parallel when scopes are disjoint.

```yaml cairn-tasks
phases:
  - id: foundations            # kebab-case, unique
    name: Foundations
    tasks:
      - id: cart-api           # kebab-case, unique across the plan
        name: Cart API
        covers: [FR-01, FR-02] # PRD FR ids
        blocked_by: []         # task ids in this or an earlier phase
        scope: ["src/cart/**", "test/cart/**"]   # globs the task may touch
        complexity: standard   # simple | standard | complex -> haiku | sonnet | opus
        risky: false           # true when it touches auth, money, deletes, migrations, a public API, untrusted input, personal data, a new dependency, model output, or shell commands and paths built from data
        # riskReason: "deletes carts"   # one line, when risky
```

### Task: cart-api

**Check:** <one line: the observable result that shows this task works, for example "POST /cart returns 201 with the created cart">

**Interfaces**
- Consumes: <exact signatures from earlier tasks, or "none">
- Produces: <exact function names, types, routes, schemas that later tasks rely on>

<!-- Risky tasks only: list the tests below. Non-risky tasks stop at Interfaces. Each PRD misuse case becomes a Security test on the task that covers it. -->

**Test cases**
- Happy: <concrete test: input -> expected result>
- Unhappy: <concrete test: failure -> expected response>
- Security: <concrete test: abuse case -> expected denial>
