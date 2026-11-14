import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { mountAs, plan, row, start, STATE, world, WT } from './world.tsx'

type El = { type: string; props: Record<string, unknown>; children: (El | string)[] }

const textOf = (n: El | string): string => (typeof n === 'string' ? n : n.children.map(textOf).join(''))
const KEY = 'active:/repo/.git:shop'
const BUILD = plan({ stage: 'execute' })

async function barRows(ui: any): Promise<string[]> {
  const bar = (await ui.find({ type: 'Box', key: 'statusbar' })) as El | undefined
  return bar === undefined ? [] : bar.children.map(textOf).map(r => r.trimEnd())
}

/** The mod's store, answered from memory beneath it. */
function memStore(on: On, entries: Record<string, unknown> = {}): Map<string, unknown> {
  const m = new Map(Object.entries(entries))
  on('store.get', (_$, e) => ({ value: m.get(e.key) as never }))
  on('store.set', (_$, e) => {
    m.set(e.key, e.value)
    return { value: undefined }
  })
  return m
}

const stored = (m: Map<string, unknown>): number => Number(m.get(KEY) ?? 0)
/** A session start saves what was counted but not saved yet, so the store then holds the exact total. */
const saved = async ($: any, m: Map<string, unknown>): Promise<number> => {
  await start($, WT)
  return stored(m)
}
const polls = async (clock: { advance: (ms: number) => Promise<unknown> }, n: number) => {
  for (let i = 0; i < n; i++) await clock.advance(2_000)
}

describe('active time', () => {
  test('counts while the main turn runs, and stops when it completes', async ($, on) => {
    const { clock } = world(on, { rows: [row(BUILD, WT)] })
    const m = memStore(on)
    await start($, WT)
    await polls(clock, 1)
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    await polls(clock, 5)
    expect(await saved($, m)).toBe(10_000)
    await $.turn.complete({ turnId: 'turn-1', reason: 'answer', answer: 'done' } as never)
    await polls(clock, 5)
    expect(await saved($, m)).toBe(10_000)
  })

  test('counts while an agent works with no main turn', async ($, on) => {
    const { clock } = world(on, { rows: [row(BUILD, WT)] })
    const m = memStore(on)
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'agent-1' }))
    await start($, WT)
    await polls(clock, 1)
    await $.agent.spawn({ prompt: 'p', description: 'Build · thing', subagentType: 'cairn:implementer' })
    await polls(clock, 3)
    expect(await saved($, m)).toBe(6_000)
  })

  test('does not count while a question is open, and counts again once it is answered', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(BUILD, WT)] })
    const m = memStore(on)
    await start($, WT)
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    await polls(clock, 1)
    w.holdAsks = true
    const asked = $.tool.call({
      tool: 'AskUserQuestion',
      questions: [{ question: 'Which template first?', header: 'Pick', multiSelect: false, options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }],
    } as never)
    await polls(clock, 6)
    expect(await saved($, m)).toBe(0)
    w.release.forEach(r => r())
    await asked
    // The first poll after a session start loads the total; the next two count.
    await polls(clock, 3)
    expect(await saved($, m)).toBe(4_000)
  })

  test('does not count while the plan is paused', async ($, on) => {
    const { clock } = world(on, { rows: [row(plan({ stage: 'execute', paused: { at: '2026-03-01T11:00:00.000Z' } }), WT)] })
    const m = memStore(on)
    await start($, WT)
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    await polls(clock, 6)
    expect(await saved($, m)).toBe(0)
  })

  test('the total loads from the store, is saved there every 15 s, and shows in the bar', async ($, on) => {
    const { clock } = world(on, { rows: [row(BUILD, WT)] })
    const m = memStore(on, { [KEY]: 60 * 60_000 })
    await start($, WT)
    const ui = await mountAs($, {})
    await polls(clock, 1)
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    await polls(clock, 10)
    expect(stored(m)).toBeGreaterThanOrEqual(60 * 60_000 + 14_000)
    expect((await barRows(ui)).some(r => /⏱ 1h 00m$/.test(r))).toBe(true)
    await ui.unmount()
  })

  test('a second plan keeps its own total: moving to it saves the first and loads its own', async ($, on) => {
    const BETA_WT = '/repo/.claude/worktrees/sdlc-beta'
    const { w, clock } = world(on, { rows: [row(BUILD, WT), row(plan({ slug: 'beta', title: 'Beta', stage: 'execute' }), BETA_WT)] })
    const m = memStore(on)
    await start($, WT)
    await polls(clock, 1)
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    await polls(clock, 3)
    // The session moves to the other plan's worktree; a state change makes the pane read the plans again.
    w.cwd = BETA_WT
    w.mtimes.set(STATE, 2)
    // That poll still counts the first plan, the next one switches, the last counts the second.
    await polls(clock, 3)
    expect(stored(m)).toBe(8_000)
    await start($, BETA_WT)
    expect(Number(m.get('active:/repo/.git:beta'))).toBe(2_000)
    expect(stored(m)).toBe(8_000)
  })

  test('inline, the active time drops before the cost when the line is short', async ($, on) => {
    const { clock } = world(on, { rows: [row(BUILD, WT)] })
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1_000, window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: 1 } } as never }))
    memStore(on, { [KEY]: 12 * 60_000 })
    await start($, WT)
    await polls(clock, 1)
    const wide = await mountAs($, { placement: 'inline' })
    expect(await barRows(wide)).toEqual(['● Build  $0.00  ⏱ 12m'])
    await wide.unmount()
    const narrow = await mountAs($, { placement: 'inline', bodyColumns: 18 })
    expect(await barRows(narrow)).toEqual(['● Build  $0.00'])
    await narrow.unmount()
  })

  test('inline, the active time follows the cost on the one bar line', async ($, on) => {
    const { clock } = world(on, { rows: [row(BUILD, WT)] })
    memStore(on, { [KEY]: 12 * 60_000 })
    await start($, WT)
    const ui = await mountAs($, { placement: 'inline' })
    await polls(clock, 1)
    expect(await barRows(ui)).toEqual(['● Build  ⏱ 12m'])
    await ui.unmount()
  })
})
