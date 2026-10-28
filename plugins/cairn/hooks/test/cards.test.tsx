import { describe, expect, test } from 'claude-code/testing'
import { estimateUsd } from '../mod/prices.ts'
import { fmtClock } from '../mod/util.ts'
import { drawn, mount, mountAs, plan, row, start, task, until, world, WT } from './world.tsx'

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

/** The text of every card line of one row ('status', 'model', 'activity'), in the order drawn. */
async function rowsOf(ui: any, row: string): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).filter((b: { key: string }) => b.key.endsWith(`:${row}`)).map(label)
}

/** The five lines of the card keyed `key`, as the Buttons the pane drew. */
async function cardOf(ui: any, key: string): Promise<any[]> {
  return (await ui.findAll({ type: 'Button' })).filter((b: { key: string }) => b.key === key || b.key.startsWith(`${key}:`))
}

describe('agent card presses (FR-11)', () => {
  test('every row of a card is one full-width press that views the agent', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(EXECUTE, WT)] })
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'agent-1' }))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.agent.spawn({ prompt: 'p', description: 'Review · a title', subagentType: 'cairn:task-reviewer' })
    await clock.advance(1_000)
    const buttons = (await ui.findAll({ type: 'Button' })).filter((b: { key: string }) => b.key.startsWith('agent:agent-1'))
    expect(buttons.map((b: { key: string }) => b.key)).toEqual(['agent:agent-1', 'agent:agent-1:status', 'agent:agent-1:model', 'agent:agent-1:activity', 'agent:agent-1:end'])
    // The press lands on the label's own cells, so each row's label fills the card's width.
    for (const b of buttons) expect([...label(b)].length).toBe(58)
    for (const b of buttons) await ui.press({ key: b.key })
    expect(w.views).toEqual(buttons.map(() => ({ agentId: 'agent-1' })))
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
    expect(text).toContain('Build · task review')
    expect(text).toContain('Build · security review')
    expect(text).not.toContain('Review · Cart')
    expect((await ui.findAll({ type: 'Button' })).filter((b: { key: string }) => /^agent:.*:status$/.test(b.key))).toHaveLength(2)
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
    expect(text).toContain('Build · building')
    expect(text).toContain('Build · fixing')
    expect(text).toContain('Look around the repo')
    expect((await rowsOf(ui, 'status')).some(l => /^│ running +● running 0:01 │$/.test(l))).toBe(true)
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
    expect((await rowsOf(ui, 'status')).some(l => /^│ Review · review +● running 0:01 │$/.test(l))).toBe(true)
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
  for (const [columns, width] of [[60, 58], [40, 38]] as const) {
    test(`at ${columns} columns every row is ${width} cells and the card stays 5 lines`, async ($, on) => {
      const { clock } = world(on, { rows: [row(EXECUTE, WT)] })
      on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'agent-1' }))
      await start($, WT)
      const ui = await mountAs($, { bodyColumns: columns })
      await $.agent.spawn({ prompt: 'p', description: 'Build · a very long task title that cannot fit on one line', subagentType: 'cairn:implementer' })
      await clock.advance(1_000)
      const buttons = (await ui.findAll({ type: 'Button' })).filter((b: { key: string }) => b.key.startsWith('agent:agent-1'))
      expect(buttons).toHaveLength(5)
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
    expect(await rowsOf(ui, 'status')).toContainEqual(expect.stringMatching(/✓ completed 1:00 │$/))
    expect(await drawn(ui)).toContain('84k tokens ~$0.30')
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
    for (const b of buttons) expect([...label(b)].length).toBe(58)
    expect(label(buttons.find((x: { key: string }) => x.key.endsWith(':model')))).toContain('420k tokens ~$1.50')
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

describe('the main session card says waiting only while it asks you', () => {
  const QUESTION = { question: 'Which template first?', header: 'Pick', multiSelect: false, options: [{ label: 'Clinical', description: 'a' }, { label: 'Modern', description: 'b' }] }

  test('idle with nothing running reads idle, not waiting for you', async ($, on) => {
    world(on, { rows: [row(EXECUTE, WT)] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    const text = await drawn(ui)
    expect(text).toContain('idle')
    expect(text).not.toContain('waiting for you')
    await ui.unmount()
  })

  test('idle while an agent works counts the agents', async ($, on) => {
    const { clock } = world(on, { rows: [row(EXECUTE, WT)] })
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'agent-1' }))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.agent.spawn({ prompt: 'p', description: 'Build · Cart', subagentType: 'cairn:implementer' })
    await clock.advance(1_000)
    expect(await drawn(ui)).toContain('1 running')
    await ui.unmount()
  })

  test('a main-session question shows waiting for you until it is answered', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(EXECUTE, WT)] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    w.holdAsks = true
    w.answer = 'Clinical'
    const asked = $.tool.call({ tool: 'AskUserQuestion', questions: [QUESTION] } as never)
    await until(clock, () => w.asked.length > 0)
    await clock.advance(1_000)
    expect(await rowsOf(ui, 'status')).toContainEqual(expect.stringMatching(/◷ waiting for you 0:01 │$/))
    w.release.forEach(r => r())
    await asked
    await clock.advance(1_000)
    const text = await drawn(ui)
    expect(text).not.toContain('waiting for you')
    expect((await rowsOf(ui, 'status')).some(l => /● working 0:0\d │$/.test(l))).toBe(true)
    await ui.unmount()
  })

  test("an agent's question leaves the main session card alone", async ($, on) => {
    const { w, clock } = world(on, { rows: [row(EXECUTE, WT)] })
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'agent-1' }))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.agent.spawn({ prompt: 'p', description: 'Build · Cart', subagentType: 'cairn:implementer' })
    w.holdAsks = true
    const asked = $.tool.call({ tool: 'AskUserQuestion', questions: [QUESTION], agentId: 'agent-1' } as never)
    await until(clock, () => w.asked.length > 0)
    await clock.advance(1_000)
    expect(await drawn(ui)).not.toContain('waiting for you')
    w.release.forEach(r => r())
    await asked
    await ui.unmount()
  })

  test('inline, the main line reads idle, then waiting for you while a question is open', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(EXECUTE, WT)] })
    await start($, WT)
    const ui = await mountAs($, { placement: 'inline' })
    expect(await drawn(ui)).toContain('● Main session · idle')
    w.holdAsks = true
    const asked = $.tool.call({ tool: 'AskUserQuestion', questions: [QUESTION] } as never)
    await until(clock, () => w.asked.length > 0)
    await clock.advance(1_000)
    expect(await drawn(ui)).toContain('● Main session · waiting for you · 1s')
    w.release.forEach(r => r())
    await asked
    await ui.unmount()
  })
})

describe('the card frame (FR-01, FR-03, FR-08, FR-11, FR-13, FR-14)', () => {
  test('a working agent draws five lines of 46 cells at 48 columns, each a press, the border orange', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(EXECUTE, WT)] })
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'agent-1' }))
    await start($, WT)
    const ui = await mountAs($, { bodyColumns: 48 })
    await $.agent.spawn({ prompt: 'p', description: 'Build · Cart', subagentType: 'cairn:implementer' })
    await clock.advance(1_000)
    const lines = await cardOf(ui, 'agent:agent-1')
    expect(lines).toHaveLength(5)
    const texts = lines.map(label)
    for (const t of texts) expect([...t].length).toBe(46)
    expect(texts[0]).toMatch(/^╭ 1 · Cart ─+╮$/)
    expect(texts[1]).toMatch(/● running 0:01 │$/)
    expect(texts[2]).toMatch(/^│ claude-sonnet-5-5 +│$/)
    expect(texts[4]).toMatch(/0 steps ───╯$/)
    for (const i of [0, 4]) expect(lines[i].children.every((c: any) => c.props.color === '#ff8700')).toBe(true)
    for (const l of lines) await ui.press({ key: l.key })
    expect(w.views).toEqual(lines.map(() => ({ agentId: 'agent-1' })))
    await ui.unmount()
  })

  test('done is green with completed and the total time; failed is red; every line stays 46 cells', async ($, on) => {
    const { clock } = world(on, { rows: [row(EXECUTE, WT)] })
    let n = 0
    on('agent.spawn', () => ({ model: 'sonnet', agentId: `agent-${++n}` }))
    await start($, WT)
    const ui = await mountAs($, { bodyColumns: 48 })
    await $.agent.spawn({ prompt: 'p', description: 'Build · Cart', subagentType: 'cairn:implementer' })
    await $.agent.spawn({ prompt: 'p', description: 'Build · Cart', subagentType: 'cairn:implementer' })
    await $.turn.complete({ turnId: 't1', agentId: 'agent-1', reason: 'answer', answer: 'x', durationMs: 372_000 } as never)
    await $.turn.complete({ turnId: 't2', agentId: 'agent-2', reason: 'error', answer: 'x', durationMs: 5_000 } as never)
    await clock.advance(1_000)
    for (const [id, word, color] of [['agent-1', '✓ completed 6:12', 'green'], ['agent-2', '✗ failed 0:05', 'red']] as const) {
      const lines = await cardOf(ui, `agent:${id}`)
      expect(lines).toHaveLength(5)
      for (const l of lines) expect([...label(l)].length).toBe(46)
      expect(label(lines[1])).toMatch(new RegExp(`${word} │$`))
      expect(lines[0].children.every((c: any) => c.props.color === color)).toBe(true)
    }
    await ui.unmount()
  })

  test('the Main card is five lines of 46 cells in each of its three states', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(EXECUTE, WT)] })
    await start($, WT)
    const ui = await mountAs($, { bodyColumns: 48 })
    const check = async (word: RegExp, color: string) => {
      const lines = await cardOf(ui, 'main')
      expect(lines).toHaveLength(5)
      for (const l of lines) expect([...label(l)].length).toBe(46)
      expect(label(lines[0])).toMatch(/^╭ Main session ─+╮$/)
      expect(label(lines[1])).toMatch(word)
      expect(lines[0].children.every((c: any) => c.props.color === color)).toBe(true)
    }
    await check(/○ idle │$/, 'gray')
    w.holdAsks = true
    w.answer = 'Clinical'
    const asked = $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Q?', header: 'Pick', multiSelect: false, options: [{ label: 'Clinical', description: 'a' }, { label: 'Modern', description: 'b' }] }] } as never)
    await until(clock, () => w.asked.length > 0)
    await clock.advance(1_000)
    await check(/◷ waiting for you 0:01 │$/, 'yellow')
    w.release.forEach(r => r())
    await asked
    await clock.advance(1_000)
    await check(/● working 0:0\d │$/, '#ff8700')
    await ui.unmount()
  })

  test('with no model known the second row starts with the tokens; with no tokens it is blank and the card keeps its height', async ($, on) => {
    const { clock } = world(on, { rows: [row(EXECUTE, WT)] })
    on('agent.spawn', () => ({ model: '', agentId: 'agent-1' }))
    stepUsage(on, 'mystery-1', 40_000, 2_000)
    await start($, WT)
    const ui = await mountAs($, { bodyColumns: 48 })
    await $.agent.spawn({ prompt: 'p', description: 'Build · Cart', subagentType: 'cairn:implementer' })
    await clock.advance(1_000)
    expect((await rowsOf(ui, 'model'))[1]).toBe(`│ ${' '.repeat(42)} │`)
    await runStep($, 'agent-1')
    await clock.advance(1_000)
    expect((await rowsOf(ui, 'model'))[1]).toMatch(/^│ 42k tokens +│$/)
    expect(await cardOf(ui, 'agent:agent-1')).toHaveLength(5)
    await ui.unmount()
  })

  test('numbers are given once at start; a card leaving does not renumber the others', async ($, on) => {
    const { clock } = world(on, { rows: [row(EXECUTE, WT)] })
    let n = 0
    on('agent.spawn', () => ({ model: 'sonnet', agentId: `agent-${++n}` }))
    await start($, WT)
    const ui = await mountAs($, { bodyColumns: 48 })
    for (let i = 0; i < 3; i++) await $.agent.spawn({ prompt: 'p', description: `Build · Task ${i + 1}`, subagentType: 'cairn:implementer' })
    await clock.advance(1_000)
    const tops = async () => (await ui.findAll({ type: 'Button' })).map(label).filter((t: string) => t.startsWith('╭ ')).map((t: string) => /^╭ (\d+|Main)/.exec(t)?.[1])
    expect(await tops()).toEqual(['Main', '1', '2', '3'])
    await $.turn.complete({ turnId: 't', agentId: 'agent-2', reason: 'answer', answer: 'x', durationMs: 1_000 } as never)
    await clock.advance(61_000)
    expect(await tops()).toEqual(['Main', '1', '3'])
    await $.agent.spawn({ prompt: 'p', description: 'Build · Task 4', subagentType: 'cairn:implementer' })
    await clock.advance(1_000)
    expect(await tops()).toEqual(['Main', '1', '3', '4'])
    await ui.unmount()
  })

  test('after a session restart the rebuilt cards are numbered in the engine list order and the counter continues', async ($, on) => {
    const { clock } = world(on, { rows: [row(EXECUTE, WT)] })
    on('agent.list', () => ({ value: [{ id: 'old-a', description: 'Build · Alpha', type: 'cairn:implementer', status: 'running' }, { id: 'old-b', description: 'Build · Beta', type: 'cairn:implementer', status: 'running' }] }) as never)
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'agent-new' }))
    await start($, WT)
    const ui = await mountAs($, { bodyColumns: 48 })
    await $.agent.spawn({ prompt: 'p', description: 'Build · Gamma', subagentType: 'cairn:implementer' })
    await clock.advance(1_000)
    const tops = (await ui.findAll({ type: 'Button' })).map(label).filter((t: string) => t.startsWith('╭ ')).map((t: string) => t.slice(0, 12))
    expect(tops.join('|')).toContain('╭ 1 · Alpha')
    expect(tops.join('|')).toContain('╭ 2 · Beta')
    expect(tops.join('|')).toContain('╭ 3 · Gamma')
    await ui.unmount()
  })

  test('narrower than 48 columns the lines shrink, the status keeps its place and the step is cut first', async ($, on) => {
    const { clock } = world(on, { rows: [row(EXECUTE, WT)] })
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'agent-1' }))
    await start($, WT)
    const ui = await mountAs($, { bodyColumns: 30 })
    await $.agent.spawn({ prompt: 'p', description: 'Review · Cart (security)', subagentType: 'cairn:security-reviewer' })
    await clock.advance(1_000)
    const texts = (await cardOf(ui, 'agent:agent-1')).map(label)
    expect(texts).toHaveLength(5)
    for (const t of texts) expect([...t].length).toBe(28)
    expect(texts[1]).toMatch(/● running 0:01 │$/)
    expect(texts[1]).toMatch(/^│ Build…? ?/)
    await ui.unmount()
  })
})

describe('fmtClock', () => {
  test('m:ss, then h:mm:ss from one hour', () => {
    expect(fmtClock(0)).toBe('0:00')
    expect(fmtClock(592_000)).toBe('9:52')
    expect(fmtClock(372_000)).toBe('6:12')
    expect(fmtClock(3_723_000)).toBe('1:02:03')
    expect(fmtClock(-5)).toBe('0:00')
  })
})

describe('the Main card in the new frame (FR-09, FR-10, FR-12, FR-16)', () => {
  const mainStatus = async (ui: any) => (await rowsOf(ui, 'status'))[0]
  const mainEnd = async (ui: any) => ((await cardOf(ui, 'main')).map(label)).at(-1)

  test('idle 9:37 after the turn ended, with two agents running: the footer and header say 2 running', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(EXECUTE, WT)] })
    let n = 0
    on('agent.spawn', () => ({ model: 'sonnet', agentId: `agent-${++n}` }))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.turn.start({ text: 'go', turnId: 't0' } as never)
    await $.turn.complete({ turnId: 't0', reason: 'answer', answer: 'x' } as never)
    await $.agent.spawn({ prompt: 'p', description: 'Build · Cart', subagentType: 'cairn:implementer' })
    await $.agent.spawn({ prompt: 'p', description: 'Build · Pay', subagentType: 'cairn:implementer' })
    await clock.advance(577_000)
    expect(await mainStatus(ui)).toMatch(/○ idle 9:37 │$/)
    expect(await mainEnd(ui)).toContain('2 running')
    expect(w.statuses.at(-1)).toMatch(/2 running/)
    await ui.unmount()
  })

  test('working counts from the turn start, not the last tool call; waiting shows the chat hint', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(EXECUTE, WT)] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.turn.start({ text: 'go', turnId: 't0' } as never)
    await clock.advance(5_000)
    await $.tool.call({ tool: 'Read', file_path: '/a/b/c.ts' } as never)
    await clock.advance(1_000)
    expect(await mainStatus(ui)).toMatch(/● working 0:06 │$/)
    w.holdAsks = true
    w.answer = 'x'
    const asked = $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'q?', header: 'h', multiSelect: false, options: [{ label: 'x', description: 'a' }, { label: 'y', description: 'b' }] }] } as never)
    await until(clock, () => w.asked.length > 0)
    await clock.advance(1_000)
    expect(await mainStatus(ui)).toMatch(/◷ waiting for you 0:01 │$/)
    expect((await rowsOf(ui, 'activity'))[0]).toContain('answer in the chat')
    w.release.forEach(r => r())
    await asked
    await ui.unmount()
  })

  test('running cards come first, oldest first, above finished ones; a done card lingers 60 s, a failed one 120 s', async ($, on) => {
    const { clock } = world(on, { rows: [row(EXECUTE, WT)] })
    let n = 0
    on('agent.spawn', () => ({ model: 'sonnet', agentId: `agent-${++n}` }))
    await start($, WT)
    const ui = await mount($, 'terminal')
    const tops = async () => (await ui.findAll({ type: 'Button' })).map(label).filter((t: string) => t.startsWith('╭ ')).map((t: string) => /^╭ (\d+|Main)/.exec(t)?.[1])
    for (let i = 0; i < 3; i++) {
      await $.agent.spawn({ prompt: 'p', description: `Build · T${i + 1}`, subagentType: 'cairn:implementer' })
      await clock.advance(1_000)
    }
    await $.turn.complete({ turnId: 'a', agentId: 'agent-1', reason: 'answer', answer: 'x', durationMs: 1 } as never)
    await clock.advance(1_000)
    await $.turn.complete({ turnId: 'b', agentId: 'agent-2', reason: 'error', answer: '', durationMs: 1 } as never)
    await clock.advance(1_000)
    expect(await tops()).toEqual(['Main', '3', '2', '1'])
    await clock.advance(59_500)
    expect(await tops()).toEqual(['Main', '3', '2'])
    await clock.advance(60_000)
    expect(await tops()).toEqual(['Main', '3'])
    await ui.unmount()
  })
})
