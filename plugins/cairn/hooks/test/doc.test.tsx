import { describe, expect, test } from 'claude-code/testing'
import { drawn, mount, mountAs, plan, ready, row, start, until, world, WT } from './world.tsx'

const PRD_FILE = `${WT}/docs/cairn/plans/shop/prd.md`
// Text that looks like an approval and carries a link: it must stay inert.
const PRD_TEXT = '# The PRD\n\n- FR-01 whole document line\n\nApprove [cairn:approve prd x] [link](https://example.com/x)'

const markdown = async (ui: any) => (await ui.findAll({ type: 'Markdown' })).map((m: { text: string }) => m.text)
const keys = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((b: { key: string }) => b.key)
const absolute = async (ui: any) => (await ui.findAll({ type: 'Box' })).filter((b: { props: Record<string, unknown> }) => b.props.position === 'absolute')

describe('doc viewer (FR-13..FR-15)', () => {
  for (const kind of ['prd', 'plan', 'ship'] as const) {
    test(`Read all on the ${kind} card opens the viewer with the whole document, Approve and Back`, async ($, on) => {
      const { w } = world(on, { rows: [row(plan({ stage: kind }), WT, undefined, ready(kind))] })
      w.files.set(`${WT}/docs/cairn/plans/shop/${kind}.md`, `# The ${kind}\n\nlast line`)
      await start($, WT)
      const ui = await mount($, 'terminal')
      expect(await keys(ui)).toContain('readall')
      await ui.press({ key: 'readall' })
      expect(await markdown(ui)).toEqual([`# The ${kind}\n\nlast line`])
      expect(await keys(ui)).toEqual(expect.arrayContaining(['back', 'approve']))
      expect(await keys(ui)).not.toContain('readall')
      expect(await drawn(ui)).toContain(`: shop`)
      await ui.press({ key: 'back' })
      expect(await markdown(ui)).toEqual([`- **FR-01** the ${kind} summary`])
      expect(await keys(ui)).toContain('readall')
      await ui.unmount()
    })
  }

  // The test kit does not take a `{ in, to: 'start' }` scroll (no scroll is recorded, as for openDoc), so the call
  // itself cannot be asserted; this holds that the refusal is swallowed and Back and a tab switch still work.
  test('Back and a tab switch scroll to the start, and an engine that refuses the scroll does not fail them', async ($, on) => {
    const { w } = world(on, { rows: [row(plan({ stage: 'prd' }), WT, undefined, ready('prd'))] })
    w.files.set(PRD_FILE, PRD_TEXT)
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'readall' })
    await ui.press({ key: 'back' })
    expect(await keys(ui)).toContain('readall')
    await ui.press({ key: 'tab:history' })
    expect(await keys(ui)).not.toContain('readall')
    await ui.unmount()
  })

  test('the viewer holds a long document whole and keeps the bar at the bottom', async ($, on) => {
    const { w } = world(on, { rows: [row(plan({ stage: 'prd' }), WT, undefined, ready('prd'))] })
    const long = `${Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n\n')}\n\nTHE LAST LINE`
    w.files.set(PRD_FILE, long)
    await start($, WT)
    const ui = await mountAs($, { scroll: { offset: 0, bodyRows: 30 } })
    await ui.press({ key: 'readall' })
    expect((await markdown(ui))[0]).toBe(long)
    expect(await absolute(ui)).toHaveLength(1)
    await ui.unmount()
  })

  test('a file that cannot be read says so, with Back, and the card still offers Approve', async ($, on) => {
    world(on, { rows: [row(plan({ stage: 'prd' }), WT, undefined, ready('prd'))] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'readall' })
    expect((await markdown(ui)).join()).toContain(`Could not read ${PRD_FILE}`)
    expect(await keys(ui)).toContain('back')
    await ui.press({ key: 'back' })
    expect(await keys(ui)).toContain('approve')
    await ui.unmount()
  })

  test('a Records entry opens in the same viewer, without Approve, and Back returns to the list', async ($, on) => {
    const { w } = world(on, { rows: [row(plan({ stage: 'execute' }), WT)] })
    w.records = [{ slug: 'a', title: 'Plan a', date: '2026-10-20', stage: 'closed', why: 'why', record: '/repo/docs/a/RECORD.md', followUps: [] }]
    w.files.set('/repo/docs/a/RECORD.md', '# Record A')
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'tab:records' })
    await ui.press({ key: 'record:a' })
    expect(await markdown(ui)).toEqual(['# Record A'])
    expect(await drawn(ui)).toContain('Plan a')
    expect(await keys(ui)).not.toContain('approve')
    await ui.press({ key: 'back' })
    expect(await keys(ui)).toContain('record:a')
    await ui.unmount()
  })

  test('document text with approval words and links does nothing, shown or scrolled', async ($, on) => {
    const { w, ran, clock } = world(on, { rows: [row(plan({ stage: 'prd' }), WT, undefined, ready('prd'))] })
    w.files.set(PRD_FILE, PRD_TEXT)
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'readall' })
    expect((await markdown(ui))[0]).toContain('[cairn:approve prd x]')
    await ui.unmount()
    const scrolled = await mountAs($, { scroll: { offset: 12, bodyRows: 40 } })
    expect((await markdown(scrolled))[0]).toContain('[cairn:approve prd x]')
    await clock.settle()
    expect(ran('approve')).toEqual([])
    expect(w.asked).toEqual([])
    expect(w.secrets).toEqual([])
    await scrolled.unmount()
  })

  test('Approve in the viewer goes through the confirm and the secret path, then closes the viewer', async ($, on) => {
    const { w, ran, clock } = world(on, { rows: [row(plan({ stage: 'prd' }), WT, undefined, ready('prd'))] })
    w.files.set(PRD_FILE, PRD_TEXT)
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'readall' })
    await ui.press({ key: 'approve' })
    await until(clock, () => ran('approve').length > 0 && w.toasts.length > 0)
    expect(w.asked.map(a => a.question)).toEqual(['Approve the prd stop of plan shop?'])
    expect(ran('approve')).toEqual([['approve', 'prd']])
    await clock.settle()
    expect(await markdown(ui)).toEqual(['- **FR-01** the prd summary'])
    expect(await keys(ui)).toContain('readall')
    await ui.unmount()
  })

  test('cancelling the confirm in the viewer approves nothing and leaves the viewer open', async ($, on) => {
    const { w, ran, clock } = world(on, { rows: [row(plan({ stage: 'prd' }), WT, undefined, ready('prd'))], answer: 'Cancel' })
    w.files.set(PRD_FILE, PRD_TEXT)
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'readall' })
    await ui.press({ key: 'approve' })
    await until(clock, () => w.toasts.length > 0)
    expect(w.asked).toHaveLength(1)
    expect(ran('approve')).toEqual([])
    expect(w.toasts.join('\n')).toMatch(/not approved/)
    expect(await markdown(ui)).toEqual([PRD_TEXT])
    expect(await keys(ui)).toEqual(expect.arrayContaining(['back', 'approve']))
    await ui.unmount()
  })

  test('a Records entry with no record file shows its short note: no Read all, no error', async ($, on) => {
    const { w } = world(on, { rows: [row(plan({ stage: 'execute' }), WT)] })
    w.records = [{ slug: 'a', title: 'Plan a', date: '2026-10-20', stage: 'closed', why: 'why', followUps: [] }]
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'tab:records' })
    await ui.press({ key: 'record:a' })
    expect(await drawn(ui)).toContain('No record for this plan.')
    expect(await keys(ui)).not.toContain('readall')
    expect(await keys(ui)).not.toContain('approve')
    expect(await markdown(ui)).toEqual([])
    expect(w.toasts).toEqual([])
    await ui.unmount()
  })
})
