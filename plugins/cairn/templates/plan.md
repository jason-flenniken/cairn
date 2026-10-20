# Plan: <title>

> Source: prd.md. Each slice is a thin, complete path through every layer, demoable on its own, and fits one context window.

## Goal
One sentence: what this plan builds.

## Architecture
Two to three sentences: approach, key components, data flow. Name the existing patterns to follow.

## Global constraints
Values from the PRD that bind every slice, copied verbatim: versions, limits, copy, naming, platform rules. One line each.

- <constraint, exact value>

## Review focus
The five inputs or failure modes the PRD implies but no slice's tests exercise directly, most likely first. Each line names the condition and the behavior a reasonable person expects. Add the test that pins each one to the slice that owns the code.

1. <condition> -> <expected behavior>

## Deferred requirements
Optional. FR ids deliberately not covered by this plan, each with a reason.

- FR-xx: <reason>

## Phases
Phases are demoable milestones. Slices in one phase may run in parallel when scopes are disjoint.

```yaml cairn-slices
phases:
  - id: foundations            # kebab-case, unique
    name: Foundations
    slices:
      - id: cart-api           # kebab-case, unique across the plan
        name: Cart API
        covers: [FR-01, FR-02] # PRD FR ids
        blocked_by: []         # slice ids in this or an earlier phase
        scope: ["src/cart/**", "test/cart/**"]   # globs the slice may touch
        complexity: standard   # simple | standard | complex -> haiku | sonnet | opus
```

### Slice: cart-api

**Interfaces**
- Consumes: <exact signatures from earlier slices, or "none">
- Produces: <exact function names, parameter and return types, routes, schemas that later slices rely on>

**Test cases**
- Happy: <concrete test: input -> expected result>
- Unhappy: <concrete test: failure -> expected response>
- Security: <concrete test: abuse case -> expected denial>

**Done when**
- <checkable condition, for example "the cart API tests pass and POST /cart returns 201 with the created cart">
