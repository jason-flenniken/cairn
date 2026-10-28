import { describe, expect, test } from 'claude-code/testing'
import { gitLine, parseStatus } from '../mod/git.ts'
import { mount, plan, row, start, world, WT } from './world.tsx'

type El = { type: string; props: Record<string, unknown>; children: (El | string)[] }

const textOf = (n: El | string): string => (typeof n === 'string' ? n : n.children.map(textOf).join(''))
const FRAME = /[╭╮╰╯│─]/

const CLEAN = '# branch.oid 0123456789abcdef\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n'

/** The Box drawn around the card keyed `key`. */
async function cardBox(ui: any, key: string): Promise<El | undefined> {
  return (await ui.findAll({ type: 'Box' })).find((b: El) => b.props.key === `${key}:card`)
}

async function barRows(ui: any): Promise<El[]> {
  const bar = (await ui.find({ type: 'Box', key: 'statusbar' })) as El | undefined
  return bar === undefined ? [] : (bar.children as El[])
}

/** A docked pane with a git state, a model and a cost, so the bar has its git and usage groups. */
function docked(on: any) {
  const made = world(on, { rows: [row(plan({ stage: 'execute' }), WT)] })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 24_000, window: 200_000, percent: 12 }, rateLimits: [], cost: { usd: 1 } } as never }))
  on('session.model', () => ({ value: 'claude-opus-5-5' as never }))
  made.w.git = CLEAN
  return made
}

describe('cards off a grid of cells (desktop)', () => {
  test('the Main card is a rounded Box in its status color, with no frame drawn as text', async ($, on) => {
    world(on, { rows: [row(plan({ stage: 'execute' }), WT)] })
    await start($, WT)
    const ui = await mount($, 'desktop')
    const box = await cardBox(ui, 'main')
    expect(box?.props.borderStyle).toBe('round')
    expect(box?.props.borderColor).toBe('gray')
    expect(textOf(box!)).toContain('Main session')
    expect(textOf(box!)).toContain('○ idle')
    expect(textOf(box!)).not.toMatch(FRAME)
    await ui.unmount()
  })

  test('the status sits at the right of its row by flex, not by padding with spaces', async ($, on) => {
    world(on, { rows: [row(plan({ stage: 'execute' }), WT)] })
    await start($, WT)
    const ui = await mount($, 'desktop')
    const status = (await ui.findAll({ type: 'Box' })).find((b: El) => b.props.key === 'main:status') as El
    expect(status.props.justifyContent).toBe('space-between')
    expect(textOf(status)).not.toMatch(/ {2}/)
    await ui.unmount()
  })

  test('the title is the press that views the conversation', async ($, on) => {
    world(on, { rows: [row(plan({ stage: 'execute' }), WT)] })
    await start($, WT)
    const ui = await mount($, 'desktop')
    const press = (await ui.findAll({ type: 'Button' })).find((b: { key: string }) => b.key === 'main')
    expect(textOf(press as El)).toBe('Main session')
    await ui.unmount()
  })

  test('the terminal keeps its frame drawn as text', async ($, on) => {
    world(on, { rows: [row(plan({ stage: 'execute' }), WT)] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    expect(await cardBox(ui, 'main')).toBeDefined()
    const top = (await ui.findAll({ type: 'Button' })).find((b: { key: string }) => b.key === 'main') as El
    expect(textOf(top)).toMatch(/^╭ Main session ─+╮$/)
    await ui.unmount()
  })
})

describe('the bar off a grid of cells (desktop)', () => {
  test('groups part with a blank row, not a rule, and no line is padded with spaces', async ($, on) => {
    const { clock } = docked(on)
    await start($, WT)
    const ui = await mount($, 'desktop')
    await clock.advance(2_000)
    const rows = (await barRows(ui)).map(textOf)
    expect(rows[0]).toMatch(/^⎇ main {2}✓ clean$/)
    expect(rows[1]).toBe(' ')
    expect(rows[2]).toMatch(/^🧠.*\S$/)
    for (const r of rows) expect(r).not.toContain('─')
    await ui.unmount()
  })

  test('the git line marks the gap before the active time, so a surface off the grid can push the time right', () => {
    const line = gitLine({ ...parseStatus(CLEAN)! }, 5 * 60_000, 46)
    const at = line.findIndex(seg => seg.fill === true)
    expect(at).toBeGreaterThan(0)
    expect(line.slice(at + 1).map(seg => seg.text).join('')).toBe('⏱ 5m')
  })
})
