import { describe, expect, test } from 'claude-code/testing'
import { MAIN, mount, mountAs, plan, row, start, world, WT } from './world.tsx'

type El = { type: string; props: Record<string, unknown>; children: (El | string)[] }
type Limit = { kind: string; percentUsed: number; resetsAt?: string }

const textOf = (n: El | string): string => (typeof n === 'string' ? n : n.children.map(textOf).join(''))
const width = (text: string) => [...text].reduce((n, ch) => n + (/\p{Emoji_Presentation}/u.test(ch) ? 2 : 1), 0)

async function barRows(ui: any): Promise<string[]> {
  const bar = (await ui.find({ type: 'Box', key: 'statusbar' })) as El | undefined
  return bar === undefined ? [] : bar.children.map(textOf).map(r => r.trimEnd())
}

const BUILD = plan({ stage: 'execute' })
const measure = (cost: number | undefined, over: { percent?: number; tokens?: number; rateLimits?: Limit[] } = {}) => ({
  context: { tokens: over.tokens ?? 24_000, window: 200_000, percent: over.percent ?? 12 },
  rateLimits: over.rateLimits ?? [],
  cost: cost === undefined ? undefined : { usd: cost },
  changed: ['context', 'rateLimits', 'cost'],
})

/** The session reports `now` as its usage; the tests move it between calls. */
function session(on: any, initial: ReturnType<typeof measure>) {
  const s = { usage: initial }
  on('session.usage', () => ({ value: { startedAt: 0, ...s.usage } as never }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.model', () => ({ value: 'claude-opus-5-5' as never }))
  return s
}

describe('usage lines (FR-03, FR-05)', () => {
  test('the plan cost counts from when the plan became active: $10.00 then $14.10 shows $4.10', async ($, on) => {
    world(on, { rows: [row(BUILD, WT)] })
    const s = session(on, measure(10))
    await start($, WT)
    const ui = await mount($, 'terminal')
    s.usage = measure(14.1)
    await $.session.measure(measure(14.1) as never)
    const rows = await barRows(ui)
    expect(rows.at(-1)).toContain('💰 $4.10')
    expect(rows.at(-1)).toContain('plan')
    expect(rows.at(-1)).toContain('🧠 Opus 5.5')
    expect(rows.at(-1)).toMatch(/⛁ █░░░░░ 12%/)
    expect(rows.at(-1)).toContain('24k tok')
    await ui.unmount()
  })

  test('a session.measure event changes the shown cost and percent', async ($, on) => {
    world(on, { rows: [row(BUILD, WT)] })
    session(on, measure(10, { percent: 12 }))
    await start($, WT)
    const ui = await mount($, 'terminal')
    expect((await barRows(ui)).at(-1)).toContain('12%')
    await $.session.measure(measure(11.5, { percent: 60 }) as never)
    const line = (await barRows(ui)).at(-1)!
    expect(line).toContain('$1.50')
    expect(line).toContain('60%')
    await ui.unmount()
  })

  test('with no active plan the line carries the session total, labelled session', async ($, on) => {
    world(on, { rows: [] })
    session(on, measure(22.12))
    await start($, MAIN)
    const ui = await mount($, 'terminal')
    const line = (await barRows(ui)).at(-1)!
    expect(line).toContain('💰 $22.12 session')
    await ui.unmount()
  })

  test('when the plan is resumed after a pause, the cost starts over', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(plan({ stage: 'execute', paused: { at: 'x' } }), WT)] })
    const s = session(on, measure(10))
    await start($, WT)
    const ui = await mount($, 'terminal')
    // Paused when first seen: no baseline yet, so the session total shows; the resume (at $12) starts the plan's cost over.
    expect((await barRows(ui)).at(-1)).toContain('$10.00 session')
    s.usage = measure(12)
    await $.session.measure(measure(12) as never)
    w.rows = [row(BUILD, WT)]
    w.mtimes.set('/repo/.git/refs/heads/sdlc', 2)
    w.mtimes.set('/repo/.git/worktrees', 2)
    w.mtimes.set('/repo/.claude/worktrees/sdlc-shop/docs/sdlc/plans/shop/state.json', 2)
    await clock.advance(2_000)
    await $.session.measure(measure(13) as never)
    expect((await barRows(ui)).at(-1)).toContain('$1.00 plan')
    await ui.unmount()
  })

  test('no cost reported: tokens and context only, no dollar figure', async ($, on) => {
    world(on, { rows: [row(BUILD, WT)] })
    session(on, measure(undefined))
    await start($, WT)
    const ui = await mount($, 'terminal')
    const line = (await barRows(ui)).at(-1)!
    expect(line).not.toContain('$')
    expect(line).toContain('12%')
    expect(line).toContain('24k tok')
    await ui.unmount()
  })
})

describe('limits line (FR-04, NFR-01)', () => {
  const RESET = new Date(2026, 2, 1, 14, 30).toISOString()
  const at = async ($: any, on: any, limits: Limit[]) => {
    world(on, { rows: [row(BUILD, WT)] })
    session(on, measure(10, { rateLimits: limits }))
    await start($, WT)
    return mountAs($, { bodyColumns: 48 })
  }

  test('5%: plain entries for both windows, no reset time', async ($, on) => {
    const ui = await at($, on, [{ kind: 'five_hour', percentUsed: 5 }, { kind: 'seven_day', percentUsed: 39 }])
    const rows = await barRows(ui)
    expect(rows.at(-1)).toBe('⏳ 5h ░░░░░ 5%  📅 7d ██░░░ 39%')
    expect(rows.at(-1)).not.toContain('↻')
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.find((t: any) => t.text === '⏳ 5h ░░░░░ 5%')?.props.color).toBeUndefined()
    await ui.unmount()
  })

  test('85%: warning color and the reset time; 97%: error color', async ($, on) => {
    const ui = await at($, on, [{ kind: 'five_hour', percentUsed: 85, resetsAt: RESET }, { kind: 'seven_day', percentUsed: 97 }])
    const rows = await barRows(ui)
    expect(rows.at(-1)).toContain('↻14:30')
    const texts = (await ui.findAll({ type: 'Text' })) as any[]
    expect(texts.find(t => t.text.startsWith('⏳ 5h') && !t.text.includes('📅'))?.props.color).toBe('warning')
    expect(texts.find(t => t.text.startsWith('📅 7d') && !t.text.includes('⏳'))?.props.color).toBe('error')
    await ui.unmount()
  })

  test('no rate limits: the line is left out', async ($, on) => {
    const ui = await at($, on, [])
    const rows = await barRows(ui)
    expect(rows.some(r => r.includes('⏳') || r.includes('📅'))).toBe(false)
    expect(rows.at(-1)).toContain('🧠')
    await ui.unmount()
  })

  test('every bar line fits 46 columns with the worst case', async ($, on) => {
    const ui = await at($, on, [{ kind: 'five_hour', percentUsed: 100, resetsAt: RESET }, { kind: 'seven_day', percentUsed: 99.5, resetsAt: new Date(2026, 2, 5, 9, 5).toISOString() }])
    for (const r of await barRows(ui)) expect([r, width(r)]).toEqual([r, expect.any(Number)]), expect(width(r)).toBeLessThanOrEqual(46)
    await ui.unmount()
  })
})

describe('inline (FR-06)', () => {
  test('one line: the active stage, the plan cost, and the 5h and 7d percents, within 7 rows', async ($, on) => {
    world(on, { rows: [row(BUILD, WT)] })
    session(on, measure(10, { rateLimits: [{ kind: 'five_hour', percentUsed: 5 }, { kind: 'seven_day', percentUsed: 39 }] }))
    await start($, WT)
    const ui = await mountAs($, { placement: 'inline' })
    await $.session.measure(measure(14.1, { rateLimits: [{ kind: 'five_hour', percentUsed: 5 }, { kind: 'seven_day', percentUsed: 39 }] }) as never)
    const rows = await barRows(ui)
    expect(rows).toEqual(['● Build  $4.10  5h 5%  7d 39%'])
    const rowsOf = (n: El): number => n.type === 'Box' && n.props.flexDirection === 'column' ? n.children.reduce((k: number, c) => k + (typeof c === 'string' ? 1 : rowsOf(c)), 0) : 1
    expect(rowsOf((await ui.findAll({ type: 'Box' }))[0] as El)).toBeLessThanOrEqual(7)
    await ui.unmount()
  })
})
