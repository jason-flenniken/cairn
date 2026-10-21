import { describe, expect, test } from 'claude-code/testing'
import { drawn, mount, plan, row, start, task, world, WT } from './world.tsx'

// FR-08, FR-09: after Build the header and status line show the stage, its step and the running agents.
const done = task('a', 'A', { status: 'done' })
const late = (stage: string, over: Record<string, unknown> = {}) =>
  plan({ stage, phases: [{ id: 'p1', name: 'Core', status: 'done', tasks: [done] }], ...over })
const step = (stage: string, name: string, count?: number) => ({ stage, name, at: '2026-03-01T11:00:00.000Z', ...(count === undefined ? {} : { count }) })

describe('late-stage header (FR-08, FR-09)', () => {
  test('review with a fixing step reads "Review · fixing 3 findings" in the header and the status line', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(late('review', { step: step('review', 'fixing', 3) }), WT)] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    await clock.advance(2_000)
    const text = await drawn(ui)
    expect(text).toContain('Review · fixing 3 findings')
    expect(text).not.toContain('all phases done')
    expect(w.statuses.at(-1)).toBe('cairn · Review · fixing 3 findings')
    await ui.unmount()
  })

  test('review with no step and one working card reads "Review · 1 running"', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(late('review'), WT)] })
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'agent-1' }))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.agent.spawn({ prompt: 'p', description: 'Review · whole branch', subagentType: 'cairn:branch-reviewer' })
    await clock.advance(2_000)
    expect(await drawn(ui)).toContain('Review · 1 running')
    expect(w.statuses.at(-1)).toBe('cairn · Review · 1 running')
    await ui.unmount()
  })

  for (const stage of ['verify', 'review', 'ship', 'learn']) {
    test(`${stage}: a step from another stage is ignored and the header never says "all phases done"`, async ($, on) => {
      const { clock } = world(on, { rows: [row(late(stage, { step: step(stage === 'verify' ? 'review' : 'verify', 'testing') }), WT)] })
      await start($, WT)
      const ui = await mount($, 'terminal')
      await clock.advance(2_000)
      const text = await drawn(ui)
      expect(text).not.toContain('all phases done')
      expect(text).not.toContain('running tests')
      await ui.unmount()
    })
  }
})
