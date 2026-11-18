# Proofs: <title>

> Plan: <slug>. The end state, as checks that run. Written before the build, seen failing, then locked when the plan loads: builders may add proofs but never edit or remove one. Every PRD requirement is covered by a proof, listed under Not provable, or deferred in plan.md.

## How they run
<One or two lines: the runner, and anything a proof needs first (a seeded database, the dev server). Each `run` is a shell command run from the repo root. Screenshots go to `$CAIRN_SHOTS/<name>.png`.>

## Proofs

```yaml cairn-proofs
proofs:
  # A behavior: the command exits 0 only when the requirement holds.
  - id: checkout-total
    covers: [FR-01]
    run: npx playwright test proofs/checkout-total.spec.ts
    files: [proofs/checkout-total.spec.ts]
  # A UI flow: assertions decide pass or fail; the screenshots are judged against `look` by a fresh agent.
  - id: cart-layout
    covers: [FR-02]
    run: npx playwright test proofs/cart-layout.spec.ts
    files: [proofs/cart-layout.spec.ts]
    shots: [cart, confirm]
    look: The cart lists each item with its price on one row and the total under them; the confirm screen shows the order number. (Or the path of an approved mockup.)
  # A guard: behavior that works today and must keep working. Green from the start.
  # - id: login-still-works
  #   covers: [FR-03]
  #   run: npm test -- login.test.ts
  #   files: [test/login.test.ts]
  #   expect: pass
```

## Not provable
Optional. Only requirements no command can check (wording, a judgment call). Each needs a reason; the acceptance checker reads these.

- FR-05: <reason>
