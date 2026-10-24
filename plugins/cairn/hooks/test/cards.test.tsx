import { describe, expect, test } from 'claude-code/testing'
import { estimateUsd } from '../mod/prices.ts'
import { drawn, mount, mountAs, plan, row, start, task, world, WT } from './world.tsx'

const EXECUTE = plan({
  phases: [{ id: 'p1', name: 'Core', status: 'in_progress', tasks: [task('cart', 'Cart', { status: 'in_progress' })] }],
})

/** One model step of an agent, drained as the engine would. */
async function runStep($: any, agentId: string, index = 0): Promise<void> {
  for await (const _chunk of $.turn.step({ turnId: 't1', index, model: 'm', messageCount: 1, agentId })) void _chunk
}

/** Answers every step as the engine would, reporting this usage. */
function stepUsage(on: any, model: string, input: number, output: number) {
  on('turn.step', async function* (_$: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { model, input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
  })
}

const label = (b: { label?: string; text?: string }) => b.label ?? b.text ?? ''

describe('agent card presses (FR-11)', () => {
  test('every row of a card is one full-width press that views the agent', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(EXECUTE, WT)] })
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'agent-1' }))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.agent.spawn({ prompt: 'p', description: 'Review · a title', subagentType: 'cairn:task-reviewer' })
    await clock.advance(1_000)
    const buttons = (await ui.findAll({ type: 'Button' })).filter((b: { key: string }) => b.key.startsWith('agent:agent-1'))
    expect(buttons.map((b: { key: string }) => b.key)).toEqual(['agent:agent-1', 'agent:agent-1:status', 'agent:agent-1:activity'])
    // The press lands on the label's own cells, so each row's label fills the card's width.
    for (const b of buttons) expect([...label(b)].length).toBe(54)
    for (const b of buttons) await ui.press({ key: b.key })
    expect(w.views).toEqual([{ agentId: 'agent-1' }, { agentId: 'agent-1' }, { agentId: 'agent-1' }])
    await ui.unmount()
  })

  test('a refused switch to an ended agent is a toast and the pane stays as it was', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(EXECUTE, WT)] })
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'agent-1' }))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.agent.spawn({ prompt: 'p', description: 'Review · a title', subagentType: 'cairn:task-reviewer' })
    await clock.advance(1_000)
    const before = await drawn(ui)
    w.viewDeny = 'no agent holds that id'
    await ui.press({ key: 'agent:agent-1:status' })
    expect(w.toasts.join()).toContain("transcript isn't available")
    expect(w.toasts.join()).toContain('no agent holds that id')
    expect(await drawn(ui)).toBe(before)
    await ui.unmount()
  })
})

describe('where an agent is in the process', () => {
  const TWO = plan({
    phases: [{ id: 'p1', name: 'Core', status: 'in_progress', tasks: [task('cart', 'Cart', { status: 'in_progress', substep: 'reviewing' }), task('pay', 'Payments')] }],
  })

  test('a task\'s two reviewers read Build · task review and Build · security review, under the task\'s name', async ($, on) => {
    const { clock } = world(on, { rows: [row(TWO, WT)] })
    let n = 0
    on('agent.spawn', () => ({ model: 'sonnet', agentId: `agent-${++n}` }))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.agent.spawn({ prompt: 'p', description: 'Review · Cart', subagentType: 'cairn:task-reviewer' })
    await $.agent.spawn({ prompt: 'p', description: 'Review · Cart (security)', subagentType: 'cairn:security-reviewer' })
    await clock.advance(1_000)
    const text = await drawn(ui)
    expect(text).toContain('● Build · task review · 1s')
    expect(text).toContain('● Build · security review · 1s')
    expect(text).not.toContain('Review · Cart')
    expect(text).not.toContain('● working')
    await ui.unmount()
  })

  test('implementer, fixer and a branch review each name their step; a description with no role stays as it was', async ($, on) => {
    const { clock } = world(on, { rows: [row(TWO, WT)] })
    let n = 0
    on('agent.spawn', () => ({ model: 'sonnet', agentId: `agent-${++n}` }))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.agent.spawn({ prompt: 'p', description: 'Build · Payments', subagentType: 'cairn:implementer' })
    await $.agent.spawn({ prompt: 'p', description: 'Fix · Cart', subagentType: 'cairn:implementer' })
    await $.agent.spawn({ prompt: 'p', description: 'Look around the repo', subagentType: 'Explore' })
    await clock.advance(1_000)
    const text = await drawn(ui)
    expect(text).toContain('● Build · building')
    expect(text).toContain('● Build · fixing')
    expect(text).toContain('Look around the repo')
    expect(text).toContain('● working · 1s')
    await ui.unmount()
  })

  test('at the Review stage a whole-branch reviewer reads Review · review under "Whole branch"', async ($, on) => {
    const { clock } = world(on, { rows: [row(plan({ stage: 'review' }), WT)] })
    on('agent.spawn', () => ({ model: 'opus', agentId: 'agent-1' }))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.agent.spawn({ prompt: 'p', description: 'Review · whole branch', subagentType: 'cairn:branch-reviewer' })
    await clock.advance(1_000)
    const text = await drawn(ui)
    expect(text).toContain('Whole branch')
    expect(text).toContain('● Review · review · 1s')
    await ui.unmount()
  })

  test('inline, the agent line carries the step', async ($, on) => {
    const { clock } = world(on, { rows: [row(TWO, WT)] })
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'agent-1' }))
    await start($, WT)
    const ui = await mountAs($, { placement: 'inline' })
    await $.agent.spawn({ prompt: 'p', description: 'Review · Cart (security)', subagentType: 'cairn:security-reviewer' })
    await clock.advance(1_000)
    expect(await drawn(ui)).toContain('● Cart · Build · security review · 1s')
    await ui.unmount()
  })
})

describe('card rows follow the body width', () => {
  for (const [columns, width] of [[60, 54], [40, 34]] as const) {
    test(`at ${columns} columns every row is ${width} cells and the card stays 3 lines`, async ($, on) => {
      const { clock } = world(on, { rows: [row(EXECUTE, WT)] })
      on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'agent-1' }))
      await start($, WT)
      const ui = await mountAs($, { bodyColumns: columns })
      await $.agent.spawn({ prompt: 'p', description: 'Build · a very long task title that cannot fit on one line', subagentType: 'cairn:implementer' })
      await clock.advance(1_000)
      const buttons = (await ui.findAll({ type: 'Button' })).filter((b: { key: string }) => b.key.startsWith('agent:agent-1'))
      expect(buttons).toHaveLength(3)
      for (const b of buttons) expect([...label(b)].length).toBe(width)
      await ui.unmount()
    })
  }
})

describe('agent card tokens and cost (FR-12)', () => {
  test('a running card shows tokens that rise with each step, and ~$ for a known model', async ($, on) => {
    const { clock } = world(on, { rows: [row(EXECUTE, WT)] })
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'agent-1' }))
    stepUsage(on, 'claude-sonnet-5-5', 40_000, 2_000)
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.agent.spawn({ prompt: 'p', description: 'Build · Cart', subagentType: 'cairn:implementer' })
    await $.turn.start({ text: 'p', turnId: 't1', agentId: 'agent-1' })
    await clock.advance(1_000)
    expect(await drawn(ui)).not.toContain('tokens')
    await runStep($, 'agent-1')
    await clock.advance(1_000)
    expect(await drawn(ui)).toContain('42k tokens ~$0.15')
    await runStep($, 'agent-1', 1)
    await clock.advance(1_000)
    expect(await drawn(ui)).toContain('84k tokens ~$0.30')
    await $.turn.complete({ turnId: 't1', agentId: 'agent-1', reason: 'answer', answer: 'done', durationMs: 60_000, usage: { model: 'claude-sonnet-5-5', input_tokens: 80_000, output_tokens: 4_000 } } as never)
    expect(await drawn(ui)).toContain('✓ finished · 1m 0s · 84k tokens ~$0.30')
    await ui.unmount()
  })

  test('an unknown model shows tokens only', async ($, on) => {
    const { clock } = world(on, { rows: [row(EXECUTE, WT)] })
    on('agent.spawn', () => ({ model: 'mystery-1', agentId: 'agent-1' }))
    stepUsage(on, 'mystery-1', 40_000, 2_000)
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.agent.spawn({ prompt: 'p', description: 'Build · Cart', subagentType: 'cairn:implementer' })
    await runStep($, 'agent-1')
    await clock.advance(1_000)
    const text = await drawn(ui)
    expect(text).toContain('42k tokens')
    expect(text).not.toContain('~$')
    await ui.unmount()
  })

  test('the working status line keeps its tokens and cost within the docked card', async ($, on) => {
    const { clock } = world(on, { rows: [row(EXECUTE, WT)] })
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'agent-1' }))
    stepUsage(on, 'claude-sonnet-5-5', 400_000, 20_000)
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.agent.spawn({ prompt: 'p', description: 'Build · a very long task title that cannot fit on one line', subagentType: 'cairn:implementer' })
    await runStep($, 'agent-1')
    await clock.advance(1_000)
    const buttons = (await ui.findAll({ type: 'Button' })).filter((x: { key: string }) => x.key.startsWith('agent:agent-1'))
    for (const b of buttons) expect([...label(b)].length).toBe(54)
    expect(label(buttons.find((x: { key: string }) => x.key.endsWith(':status')))).toContain('420k tokens ~$1.50')
    await ui.unmount()
  })
})

const round = (n: number | undefined) => Math.round((n ?? 0) * 1e6) / 1e6

describe('estimateUsd', () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 }
  test('prices a model by its family, so a new point version still estimates', () => {
    expect(round(estimateUsd('claude-sonnet-5-5', usage))).toBe(round(3 + 15 + 0.3 + 3.75))
    expect(round(estimateUsd('claude-opus-5-5', usage))).toBe(round(5 + 25 + 0.5 + 6.25))
    expect(round(estimateUsd('claude-haiku-5-5', usage))).toBe(round(1 + 5 + 0.1 + 1.25))
    expect(round(estimateUsd('claude-opus-4-1-20250805', usage))).toBe(round(15 + 75 + 1.5 + 18.75))
    expect(round(estimateUsd('claude-opus-4-5-20251101', usage))).toBe(round(5 + 25 + 0.5 + 6.25))
    expect(round(estimateUsd('claude-3-5-haiku-20241022', usage))).toBe(round(0.8 + 4 + 0.08 + 1))
  })
  test('an unknown model has no estimate', () => {
    expect(estimateUsd('gpt-9', usage)).toBeUndefined()
  })
})
