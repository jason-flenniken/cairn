import { describe, expect, test } from 'claude-code/testing'
import { drawn, mount, plan, row, start, until, world, WT } from './world.tsx'

const mk = (key: string, title: string, over: Record<string, unknown> = {}) => ({ key, title, ...over })
const BOARD: any = {
  ok: true, message: '', project: 'Shop', readAt: '2026-03-01T11:00:00.000Z', ageMinutes: 90, cycle: null, focus: 'Beta',
  plans: [{ slug: 'cart', title: 'Cart', stage: 'execute', issues: ['SAV-2'], stalled: true }],
  milestones: [
    { name: 'Alpha', counts: { total: 2, done: 2, inPlan: 0, ready: 0, blocked: 0 }, epics: [], issues: [] },
    { name: 'Beta', counts: { total: 12, done: 3, inPlan: 6, ready: 2, blocked: 1 }, epics: [], issues: [] },
    { name: 'Gamma', waitsOn: ['SAV-1', 'SAV-2', 'SAV-3', 'SAV-4', 'SAV-5'], counts: { total: 4, done: 0, inPlan: 0, ready: 0, blocked: 4 }, epics: [], issues: [] },
  ],
  inProgress: [{
    slug: 'cart', stage: 'execute', epic: 'SAV-1', title: 'Checkout', done: 1, total: 6,
    issues: [1, 2, 3, 4, 5, 6].map(n => mk(`SAV-1${n}`, `Sub ${n}`, { progress: n === 1 ? 'built' : n === 2 ? 'in progress' : 'not started' })),
  }],
  ready: [
    mk('SAV-30', 'Big unblocker', { kind: 'issue', milestone: 'Beta', unblocks: 9 }),
    mk('SAV-31', 'Leaf', { kind: 'issue', milestone: 'Beta', unblocks: 0 }),
    mk('SAV-32', 'Later thing', { kind: 'issue', milestone: 'Gamma', unblocks: 1 }),
  ],
  waiting: [
    mk('SAV-40', 'Payments', { kind: 'epic', done: 0, total: 9, waitsOn: ['SAV-30', 'SAV-31', 'SAV-32', 'SAV-33'] }),
    mk('SAV-50', 'Loose issue', { kind: 'issue', waitsOn: ['SAV-40'] }),
  ],
  done: 5,
  wideLinks: [{ epic: 'SAV-19', on: 'SAV-18', holds: 9 }],
}
const CONFIG = `${WT}/.cairn/config.json`
const keys = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((b: { key: string }) => b.key)

async function tabUi($: any, on: any, board: unknown) {
  const { w } = world(on, { rows: [row(plan({ stage: 'execute' }), WT)] })
  w.files.set(CONFIG, JSON.stringify({ linear: { team: 'SAV' } }))
  w.linearBoard = board
  await start($, WT)
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'tab:linear' })
  return ui
}
const tab = async ($: any, on: any, board: unknown) => drawn(await tabUi($, on, board))

describe('Linear tab', () => {
  test('shows the board once Linear is set up', async ($, on) => {
    const { w } = world(on, { rows: [row(plan({ stage: 'execute' }), WT)] })
    w.files.set(CONFIG, JSON.stringify({ linear: { team: 'SAV' } }))
    w.linearBoard = BOARD
    await start($, WT)
    const ui = await mount($, 'terminal')
    expect(await keys(ui)).toContain('tab:linear')
    await ui.press({ key: 'tab:linear' })
    const text = await drawn(ui)
    const at = (needle: string) => text.indexOf(needle)
    expect(text).toContain('Shop · read 2 h ago')
    expect(text).toContain('✓ Alpha')
    expect(text).toContain('Beta ███░░░░░░░ 3/12')
    expect(text).toContain('Gamma  0/4  waits on SAV-1, SAV-2, SAV-3 +2')
    const order = ['Shop · read', '▶ IN PROGRESS', '○ READY TO START', '· WAITING', '✓ DONE 5 issues', "SAV-19's blocked-by link to SAV-18 makes all 9 of its open issues wait. Link only the sub-issues that need SAV-18."]
    expect(order.map(at).every((n, i, a) => n >= 0 && (i === 0 || n > a[i - 1]))).toBe(true)
    expect(text).toContain('No change in over a week: cart (execute)')
    await ui.unmount()
  })

  test('a plan with 6 issues draws 4 issue lines and +2 more, built and started marked ◐, not started ·', async ($, on) => {
    const text = await tab($, on, BOARD)
    expect(text).toContain('SAV-1 Checkout')
    expect(text).toContain('cart · execute · 1/6')
    expect(text).toContain('◐ SAV-11 Sub 1')
    expect(text).toContain('◐ SAV-12 Sub 2')
    expect(text).toContain('· SAV-13 Sub 3')
    expect(text).toContain('· SAV-14 Sub 4')
    expect(text).not.toContain('SAV-15 Sub 5')
    expect(text).toContain('+2 more')
  })

  test('ready rows keep the board order, unblocks only above 0, and a later milestone shows its name', async ($, on) => {
    const text = await tab($, on, BOARD)
    expect(text).toContain('SAV-30 Big unblocker unblocks 9')
    expect(text).toMatch(/SAV-31 Leaf(\n|$)/)
    expect(text).not.toContain('SAV-31 Leaf unblocks')
    expect(text.indexOf('SAV-30')).toBeLessThan(text.indexOf('SAV-31'))
    expect(text.indexOf('SAV-31')).toBeLessThan(text.indexOf('SAV-32'))
    expect(text).toContain('SAV-32 Later thing unblocks 1  Gamma')
    expect(text).not.toMatch(/SAV-3[01] .*Beta/)
  })

  test('nothing ready draws the one explaining line', async ($, on) => {
    const text = await tab($, on, { ...BOARD, ready: [] })
    expect(text).toContain('○ Nothing ready: everything open waits on work in progress or blocked')
    expect(text).not.toContain('READY TO START')
  })

  test('an epic whose issues wait only on each other says so instead of an empty list', async ($, on) => {
    const text = await tab($, on, { ...BOARD, waiting: [mk('SAV-60', 'Chain', { kind: 'epic', done: 0, total: 3, waitsOn: [] })] })
    expect(text).toContain('SAV-60 Chain  0/3  waits on its own issues')
    expect(text).not.toMatch(/SAV-60 Chain .* on\s*$/m)
  })

  test('a waiting epic with 9 sub-issues is one row and none of its sub-issues appear', async ($, on) => {
    const board = { ...BOARD, waiting: [mk('SAV-19', 'Metering', { kind: 'epic', done: 0, total: 9, waitsOn: ['SAV-18'] }), mk('SAV-60', 'Loose', { kind: 'issue', waitsOn: ['SAV-19', 'SAV-18'] })] }
    board.milestones = [{ ...BOARD.milestones[1], epics: [{ key: 'SAV-19', title: 'Metering', done: 0, total: 9, plans: [], state: 'waiting', waitsOn: ['SAV-18'], issues: Array.from({ length: 9 }, (_, i) => mk(`SAV-1${i}0`, `Sub ${i}`, { status: 'blocked', blockedBy: [] })) }] }]
    const text = await tab($, on, board)
    expect(text).toContain('SAV-19 Metering  0/9  on SAV-18')
    expect(text).toContain('SAV-60 Loose  on SAV-19, SAV-18')
    expect(text.match(/SAV-1\d0/g)).toBeNull()
  })

  test('only the loop line is red', async ($, on) => {
    const ui = await tabUi($, on, { ...BOARD, cycle: ['SAV-1', 'SAV-2', 'SAV-1'] })
    const red = (await ui.findAll({ type: 'Text' })).filter((t: any) => t.props.color === 'red')
    expect(red.map((t: any) => t.text)).toEqual(['Loop in blocked-by links: SAV-1 → SAV-2 → SAV-1. Remove one link in Linear.'])
  })

  test('without a loop nothing is red', async ($, on) => {
    const ui = await tabUi($, on, BOARD)
    expect((await ui.findAll({ type: 'Text' })).some((t: any) => t.props.color === 'red')).toBe(false)
  })

  test('indented rows sit in a Box with paddingLeft, so a long title wraps at the row indent', async ($, on) => {
    const long = 'A very long ticket title that is well past the forty-six column pane so it must wrap onto a second line'
    const ui = await tabUi($, on, { ...BOARD, ready: [mk('SAV-70', long, { kind: 'issue', milestone: 'Beta', unblocks: 0 })] })
    const box = (await ui.findAll({ type: 'Box' })).find((b: any) => b.children.length === 1 && b.children[0].type === 'Text' && JSON.stringify(b.children).includes(long))
    expect(box.props.paddingLeft).toBe(2)
    const t = (await ui.findAll({ type: 'Text' })).find((x: any) => x.text.includes(long))
    expect(t.props.wrap).toBe('wrap')
    expect(t.text.startsWith(' ')).toBe(false)
  })

  test('control characters and direction overrides in a title never reach the screen, in Ready, Waiting and In progress', async ($, on) => {
    const evil = (t: string) => `\x1b[31m${t}\u202e`
    const board = {
      ...BOARD,
      inProgress: [{ slug: 'cart', stage: 'execute', epic: 'SAV-1', title: evil('Plan'), done: 0, total: 1, issues: [mk('SAV-11', evil('Sub'), { progress: 'built' })] }],
      ready: [mk('SAV-30', evil('Ready one'), { kind: 'issue', milestone: 'Beta', unblocks: 0 })],
      waiting: [mk('SAV-40', evil('Waits'), { kind: 'issue', waitsOn: ['SAV-30'] })],
    }
    const text = await tab($, on, board)
    for (const t of ['Plan', 'Sub', 'Ready one', 'Waits']) expect(text).toContain(t)
    expect(text).not.toMatch(/[\x1b\u202e]/)
  })

  test('with every milestone done there is no Ready section, only the header lines and the done count', async ($, on) => {
    const done = { name: 'Alpha', counts: { total: 2, done: 2, inPlan: 0, ready: 0, blocked: 0 }, epics: [], issues: [] }
    const text = await tab($, on, { ...BOARD, focus: null, plans: [], milestones: [done], inProgress: [], ready: [], waiting: [], wideLinks: [], done: 2 })
    expect(text).toContain('✓ Alpha')
    expect(text).toContain('✓ DONE 2 issues')
    expect(text).not.toContain('READY TO START')
    expect(text).not.toContain('Nothing ready')
  })

  test('with no snapshot it says how to read one', async ($, on) => {
    const { w } = world(on, { rows: [row(plan({ stage: 'execute' }), WT)] })
    w.files.set(CONFIG, JSON.stringify({ linear: { team: 'SAV' } }))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'tab:linear' })
    expect(await drawn(ui)).toContain('/cairn:board <project>')
    await ui.unmount()
  })

  test('without a linear block in the config there is no Linear tab and no board read', async ($, on) => {
    const { w } = world(on, { rows: [row(plan({ stage: 'execute' }), WT)] })
    w.files.set(CONFIG, JSON.stringify({ maxParallel: 2 }))
    w.linearBoard = BOARD
    await start($, WT)
    const ui = await mount($, 'terminal')
    expect(await keys(ui)).not.toContain('tab:linear')
    await until(ui, () => true).catch(() => undefined)
    expect(w.runs.some(a => a[0] === 'linear')).toBe(false)
    await ui.unmount()
  })
})
