import { describe, expect, test } from 'claude-code/testing'
import { readBackOf } from '../mod/approve.ts'
import { drawn, mount, mountAs, plan, row, start, until, world, WT } from './world.tsx'

const CARD = ['Outcome:      Genetics tab grouped', 'User:         Signed-in user', 'Out of scope: pagination'].join('\n')
const Q = 'Is this read-back right? [cairn:readback shop]'
const OPTIONS = [
  { label: 'Yes (Recommended)', description: 'The card is right', preview: CARD },
  { label: 'Fix a line', description: 'Say which line to change' },
]
const readBackAsk = (question = Q, over: Record<string, unknown> = {}) =>
  ({ tool: 'AskUserQuestion', questions: [{ question, header: 'Read-back', multiSelect: false, options: OPTIONS }], ...over }) as never

const DISCOVER = plan({ stage: 'discover' })

describe('readBackOf', () => {
  test('a tagged one-question dialog gives its slug, question, the preview as the card, and its own labels', () => {
    expect(readBackOf([{ question: Q, options: OPTIONS }])).toEqual({ slug: 'shop', question: Q, card: CARD, options: ['Yes (Recommended)', 'Fix a line'] })
  })

  test('no preview leaves the card empty; no tag, or a second question, is not a read-back', () => {
    expect(readBackOf([{ question: Q, options: [{ label: 'Yes' }] }])?.card).toBe('')
    expect(readBackOf([{ question: 'Is this right?', options: OPTIONS }])).toBeUndefined()
    expect(readBackOf([{ question: Q, options: OPTIONS }, { question: 'And this?', options: OPTIONS }])).toBeUndefined()
  })
})

describe('the read-back in the pane', () => {
  test('docked: while the question is open the pane shows the card and the question\'s options; a press answers it', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(DISCOVER, WT)] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    w.holdAsks = true
    const asked = $.tool.call(readBackAsk())
    await until(clock, () => w.asked.length > 0)
    const text = await drawn(ui)
    expect(text).toContain('Waiting on you: read-back')
    expect(text).toContain(CARD)
    await ui.press({ key: 'readback:0' })
    const got = await asked
    expect((got.result as { answers: Record<string, string> }).answers).toEqual({ [Q]: 'Yes (Recommended)' })
    expect(w.toasts).toContain('Answered in the pane')
    await clock.settle()
    expect(await drawn(ui)).not.toContain('Waiting on you: read-back')
    await ui.unmount()
  })

  test('answered in the chat, the card goes and the chat\'s answer stands', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(DISCOVER, WT)], answer: 'Fix a line' })
    await start($, WT)
    const ui = await mount($, 'terminal')
    w.holdAsks = true
    const asked = $.tool.call(readBackAsk())
    await until(clock, () => w.asked.length > 0)
    expect(await drawn(ui)).toContain('Waiting on you: read-back')
    w.release.forEach(r => r())
    const got = await asked
    expect((got.result as { answers: Record<string, string> }).answers).toEqual({ [Q]: 'Fix a line' })
    await clock.settle()
    expect(await drawn(ui)).not.toContain('Waiting on you: read-back')
    await ui.unmount()
  })

  test('inline: one row with the buttons, no card', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(DISCOVER, WT)] })
    await start($, WT)
    const ui = await mountAs($, { placement: 'inline' })
    w.holdAsks = true
    void $.tool.call(readBackAsk())
    await until(clock, () => w.asked.length > 0)
    const text = await drawn(ui)
    expect(text).toContain('Waiting on you: read-back')
    expect(text).not.toContain('Outcome:')
    expect(await ui.find({ type: 'Button', key: 'readback:1' })).toBeDefined()
    w.release.forEach(r => r())
    await ui.unmount()
  })

  test('a subagent\'s read-back, or one for another plan, is not shown', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(DISCOVER, WT)] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    w.holdAsks = true
    void $.tool.call(readBackAsk(Q, { agentId: 'a1' }))
    void $.tool.call(readBackAsk('Is this read-back right? [cairn:readback other]'))
    await until(clock, () => w.asked.length > 1)
    expect(await drawn(ui)).not.toContain('Waiting on you: read-back')
    w.release.forEach(r => r())
    await ui.unmount()
  })
})
