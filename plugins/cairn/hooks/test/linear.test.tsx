import { describe, expect, test } from 'claude-code/testing'
import { drawn, mount, plan, row, start, until, world, WT } from './world.tsx'

const issue = (key: string, title: string, status: string, over: Record<string, unknown> = {}) => ({ key, title, status, blockedBy: [], ...over })
const BOARD = {
  ok: true, message: '', project: 'Shop', readAt: '2026-03-01T11:00:00.000Z', ageMinutes: 90, cycle: null,
  plans: [{ slug: 'cart', title: 'Cart', stage: 'execute', issues: ['SAV-2'], stalled: true }],
  milestones: [{
    name: 'Beta', counts: { total: 3, done: 1, inPlan: 1, ready: 0, blocked: 1 },
    epics: [{
      key: 'SAV-1', title: 'Checkout', done: 1, total: 3, plans: ['cart'],
      issues: [
        issue('SAV-2', 'Cart API', 'in plan', { plan: { slug: 'cart', stage: 'execute', progress: 'building' } }),
        issue('SAV-3', 'Payment form', 'blocked', { blockedBy: [{ key: 'SAV-9', where: 'milestone Alpha' }] }),
        issue('SAV-4', 'Totals', 'done'),
      ],
    }],
    issues: [],
  }],
}
const CONFIG = `${WT}/.cairn/config.json`
const keys = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((b: { key: string }) => b.key)

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
    expect(text).toContain('Shop · read 2 h ago')
    expect(text).toContain('Beta: 1/3 done · 1 in plan · 0 ready · 1 blocked')
    expect(text).toContain('epic SAV-1 Checkout: 1/3 · plans cart')
    expect(text).toContain('▸ SAV-2 Cart API · cart (execute, building)')
    expect(text).toContain('✗ SAV-3 Payment form · blocked by SAV-9 [milestone Alpha]')
    expect(text).toContain('✓ SAV-4 Totals')
    expect(text).toContain('No change in over a week: cart (execute)')
    await ui.unmount()
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
