import { describe, expect, test } from 'claude-code/testing'
import type { CairnPlanState } from '../../types/index.d.ts'
import { stageSteps, type BarLine } from '../mod/bar.tsx'
import { mount, mountAs, PANE_PROPS, plan, row, start, task, world, WT, type Row } from './world.tsx'

type El = { type: string; props: Record<string, unknown>; children: (El | string)[] }

const textOf = (n: El | string): string => (typeof n === 'string' ? n : n.children.map(textOf).join(''))
const lineText = (line: BarLine) => line.map(seg => seg.text).join('')

/** Terminal cells, counted apart from the mod's own helper: an emoji takes 2. */
const width = (text: string) => [...text].reduce((n, ch) => n + (/\p{Emoji_Presentation}/u.test(ch) ? 2 : 1), 0)

/** The bar's rows as drawn, padding included. */
async function barRows(ui: any): Promise<string[]> {
  const bar = (await ui.find({ type: 'Box', key: 'statusbar' })) as El | undefined
  return bar === undefined ? [] : bar.children.map(textOf)
}

const phase = (status: string) => ({ id: `p-${status}`, name: status, status, tasks: [task(`t-${status}`, 'T')] })
const BUILD_2_OF_3 = plan({ stage: 'execute', phases: [phase('done'), phase('in_progress'), phase('pending')] })
const FIX_REVIEW = plan({ track: 'fix', stage: 'review' })
const CLOSED = plan({ stage: 'closed' })
const closedRow = (): Row => ({ ...row(CLOSED, WT), prOpen: true } as Row)

describe('stage steps (FR-02)', () => {
  test('a feature plan at Build phase 2 of 3: done, active with n/m, upcoming, in order, on two lines', () => {
    const lines = stageSteps(BUILD_2_OF_3 as CairnPlanState)
    expect(lines).toHaveLength(2)
    const text = lines.map(lineText).join('  ')
    expect(text).toBe('✓ Disc  ✓ PRD  ✓ Plan  ● Build 2/3  ○ Check  ○ Review  ○ Ship  ○ Learn')
    const segs = lines.flat().filter(seg => seg.text.trim() !== '')
    expect(segs.filter(seg => seg.text.startsWith('✓')).every(seg => seg.color === 'success')).toBe(true)
    expect(segs.find(seg => seg.text === '● Build 2/3')).toEqual({ text: '● Build 2/3', bold: true, color: 'yellowBright' })
    expect(segs.filter(seg => seg.text.startsWith('○')).every(seg => seg.dim === true)).toBe(true)
  })

  test('a fix plan at Review: only the fix track, Repro and Build done, Ship to come', () => {
    const text = stageSteps(FIX_REVIEW as CairnPlanState).map(lineText).join('  ')
    expect(text).toBe('✓ Repro  ✓ Build  ● Review  ○ Ship')
  })

  test('a closed plan with its PR open: every step done, then PR open, wrapped not cut', () => {
    const lines = stageSteps(CLOSED as CairnPlanState, true)
    expect(lines).toHaveLength(2)
    expect(lines.map(lineText).join('  ')).toBe('✓ Disc  ✓ PRD  ✓ Plan  ✓ Build  ✓ Check  ✓ Review  ✓ Ship  ✓ Learn  PR open')
    expect(stageSteps(CLOSED as CairnPlanState, false).map(lineText).join('  ')).not.toContain('PR open')
  })
})

describe('the bar on every tab (FR-01)', () => {
  const lastChild = async (ui: any) => {
    const root = (await ui.findAll({ type: 'Box' }))[0] as El
    return root.children[root.children.length - 1] as El
  }

  test('Now, History, Records and an open record each end with the bar', async ($, on) => {
    const { w } = world(on, { rows: [row(BUILD_2_OF_3, WT)] })
    w.records = [{ slug: 'a', title: 'Plan a', date: '2026-10-20', stage: 'closed', why: 'why a', record: '/repo/RECORD.md', followUps: [] }]
    w.files.set('/repo/RECORD.md', '# A')
    await start($, WT)
    const ui = await mount($, 'terminal')
    for (const key of ['tab:now', 'tab:history', 'tab:records', 'record:a']) {
      await ui.press({ key })
      expect((await lastChild(ui)).props.key).toBe('statusbar')
      expect((await barRows(ui)).join('\n')).toContain('● Build 2/3')
    }
    await ui.unmount()
  })

  test('a closed plan shows the bar with PR open under the idle view', async ($, on) => {
    world(on, { rows: [closedRow()] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    expect((await lastChild(ui)).props.key).toBe('statusbar')
    expect((await barRows(ui)).join('\n')).toContain('PR open')
    await ui.unmount()
  })

  const FIXTURES: [string, () => Row][] = [['Build 2/3', () => row(BUILD_2_OF_3, WT)], ['fix at Review', () => row(FIX_REVIEW, WT)], ['closed, PR open', closedRow]]
  for (const [name, make] of FIXTURES) {
    test(`NFR-01: at bodyColumns 46 no bar line is wider than 46 cells (${name})`, async ($, on) => {
      world(on, { rows: [make()] })
      await start($, WT)
      const ui = await mountAs($, { bodyColumns: 46 })
      const rows = await barRows(ui)
      expect(rows.length).toBeGreaterThan(0)
      for (const line of rows) expect(width(line)).toBeLessThanOrEqual(46)
      await ui.unmount()
    })
  }

  test('inline: one line at the end, in the flow, with the active step', async ($, on) => {
    world(on, { rows: [row(BUILD_2_OF_3, WT)] })
    await start($, WT)
    const ui = await mountAs($, { placement: 'inline' })
    const bar = (await lastChild(ui))
    expect(bar.props.key).toBe('statusbar')
    expect(bar.props.position).toBeUndefined()
    expect((await barRows(ui)).map(line => line.trimEnd())).toEqual(['● Build 2/3'])
    await ui.unmount()
  })
})

describe('pinning (FR-01)', () => {
  const SCROLL = { offset: 0, bodyRows: 20 }

  test('docked, the bar sits on the window\'s last rows, and a scroll move re-places it at the new bottom', async ($, on) => {
    const { w } = world(on, { rows: [row(BUILD_2_OF_3, WT)] })
    await start($, WT)
    const ui = await mountAs($, { scroll: SCROLL })
    const rows = (await barRows(ui)).length
    const place = async () => ((await ui.find({ type: 'Box', key: 'statusbar' })) as El).props
    expect(await place()).toMatchObject({ position: 'absolute', top: 20 - rows, left: 0, right: 0 })
    // The content is padded past the bar, and fills at least the window so a short tab keeps it at the bottom.
    expect(((await ui.findAll({ type: 'Box' }))[0] as El).props).toMatchObject({ minHeight: 20, paddingBottom: rows + 1 })

    const moved = await $.ui.scroll({ component: 'Pane', requestId: 'cairn', offset: 7, by: 7, bodyRows: 20, contentRows: 60, origin: { kind: 'person' } })
    expect(moved).toEqual({})
    expect(w.scrolls).toEqual([{ offset: 7, by: 7 }])
    // The engine draws again with the window where the move left it.
    await ui.redraw({ ...PANE_PROPS, scroll: { offset: 7, bodyRows: 20 } })
    expect((await place()).top).toBe(27 - rows)
    await ui.unmount()
  })
})
