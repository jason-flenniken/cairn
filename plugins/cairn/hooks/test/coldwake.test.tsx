import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { resetColdWake, stampText } from '../mod/coldwake.ts'
import { wakeChat } from '../mod/pause.ts'
import { claim, plan, row, shellOk, start, until, world, WT } from './world.tsx'

const HOUR = 60 * 60_000
const ROWS = [row(plan({ stage: 'ship' }), WT)]

/** What the session reports; the prompts that enter, each with the commands run before it (the world records those). */
function session(on: On, w: { commands: string[]; toasts: string[] }, tokens: number) {
  const s = {
    tokens,
    id: 's1',
    store: new Map<string, unknown>(),
    /** Each prompt as `text` after the commands that ran before it, joined with `>`: `clear>cairn:resume>approve`. */
    log: [] as string[],
    get toasts() {
      return w.toasts
    },
  }
  on('store.get', (_$, e) => ({ value: s.store.get(e.key) as never }))
  on('store.set', (_$, e) => {
    s.store.set(e.key, e.value)
    return { value: undefined as never }
  })
  on('session.id', () => ({ value: s.id as never }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: s.tokens, window: 1_000_000 }, rateLimits: [] } as never }))
  on('prompt.submit', (_$, e) => {
    s.log.push([...w.commands.filter(c => c === 'clear' || c === 'cairn:resume'), e.text].join('>'))
    return { text: e.text }
  })
  return s
}

/**
 * The last turn ended `ms` ago with `tokens` in the context. Written straight to the stamp: moving the clock that far
 * would run the mod's 2 s timers thousands of times.
 */
function idleFor(s: { store: Map<string, unknown> }, clock: { now: () => number }, ms: number, tokens: number) {
  s.store.set('cairn:turn-stamp:s1', stampText(clock.now() - ms, tokens))
}

/** One finished main turn, with the context at `tokens`. */
async function turn($: any, s: { tokens: number }, tokens: number, id = 't1') {
  s.tokens = tokens
  await $.turn.start({ text: 'go', turnId: id })
  await $.turn.complete({ turnId: id, reason: 'answer', answer: 'done' } as never)
}

async function ready($: any, on: On, claimed = true) {
  resetColdWake()
  const { clock, w } = world(on, { rows: ROWS })
  shellOk(on)
  const s = session(on, w, 10_000)
  await start($, WT)
  if (claimed) await claim($)
  await clock.advance(3_000)
  return { s, clock }
}

describe('a typed prompt after a long idle', () => {
  test('warm (idle under an hour): goes in place', async ($, on) => {
    const { s, clock } = await ready($, on)
    await turn($, s, 200_000)
    await clock.advance(30 * 60_000)
    await $.prompt.submit({ text: 'approve' })
    expect(s.log).toEqual(['approve'])
    expect(s.toasts.join('\n')).not.toMatch(/Idle/)
  })

  test('cold, big context, claimed plan: clears, resumes the plan, then sends what was typed', async ($, on) => {
    const { s, clock } = await ready($, on)
    await turn($, s, 200_000)
    idleFor(s, clock, 8 * HOUR, 200_000)
    await $.prompt.submit({ text: 'approve' })
    await until(clock, () => s.log.length >= 1)
    expect(s.log).toEqual(['clear>cairn:resume>approve'])
    expect(s.toasts.join('\n')).toContain("Idle 8h: started a fresh conversation from the plan's files instead of re-sending 200K tokens.")
  })

  test('cold but small context: goes in place', async ($, on) => {
    const { s, clock } = await ready($, on)
    await turn($, s, 100_000)
    idleFor(s, clock, 8 * HOUR, 100_000)
    await $.prompt.submit({ text: 'approve' })
    expect(s.log).toEqual(['approve'])
  })

  test('cold and big but no claimed plan: goes in place', async ($, on) => {
    const { s, clock } = await ready($, on, false)
    await turn($, s, 200_000)
    idleFor(s, clock, 8 * HOUR, 200_000)
    await $.prompt.submit({ text: 'approve' })
    expect(s.log).toEqual(['approve'])
  })
})

describe('a pane wake after a long idle', () => {
  const WAKE = 'cairn: the ship approval for shop is recorded (from the pane). Continue the plan: run cairn next in its worktree.'

  test('cold: clears and resumes, then sends the wake text', async ($, on) => {
    const { s, clock } = await ready($, on)
    await turn($, s, 200_000)
    idleFor(s, clock, 8 * HOUR, 200_000)
    wakeChat($, WAKE)
    await until(clock, () => s.log.length >= 1)
    expect(s.log).toEqual([`clear>cairn:resume>${WAKE}`])
  })

  test('warm: the wake text goes in place', async ($, on) => {
    const { s, clock } = await ready($, on)
    await turn($, s, 200_000)
    await clock.advance(10 * 60_000)
    wakeChat($, WAKE)
    await until(clock, () => s.log.length >= 1)
    expect(s.log).toEqual([WAKE])
  })
})

describe('the base-size notice', () => {
  const notes = (s: { toasts: string[] }) => s.toasts.filter(t => t.startsWith('Your plugins and MCP servers add ~'))

  test('fires once when the first turn is already over 60K tokens', async ($, on) => {
    const { s } = await ready($, on)
    await turn($, s, 80_000, 't1')
    await turn($, s, 90_000, 't2')
    expect(notes(s)).toHaveLength(1)
    expect(notes(s)[0]).toContain('~80K tokens to every turn')
  })

  test('is silent when the first turn is under it', async ($, on) => {
    const { s } = await ready($, on)
    await turn($, s, 30_000, 't1')
    await turn($, s, 90_000, 't2')
    expect(notes(s)).toHaveLength(0)
  })
})
