import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { drawn, mount, plan, ready, row, start, STATE, task, until, world, WT } from './world.tsx'

const SHIP = row(plan({ stage: 'ship' }), WT, undefined, ready('ship'))
const VERSION = '0.22.1'

/** The prompts sent to the chat. */
function chat(on: On) {
  const w = { sent: [] as string[] }
  on('prompt.submit', (_$, e) => {
    w.sent.push(e.text)
    return { text: e.text }
  })
  return w
}

const WAKE = 'cairn: the ship approval for shop is recorded (from the pane). Continue the plan: run cairn next in its worktree.'

describe('a pane approval wakes the chat', () => {
  test('sends one message when no turn runs', async ($, on) => {
    const { w, ran, clock } = world(on, { rows: [SHIP] })
    const c = chat(on)
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'approve' })
    await until(clock, () => ran('approve').length > 0 && c.sent.length > 0)
    expect(c.sent).toEqual([WAKE])
    await clock.advance(10_000)
    expect(c.sent).toEqual([WAKE])
    expect(w.toasts.join('\n')).toMatch(/ship approved/)
    await ui.unmount()
  })

  test('while a turn runs it waits, and goes out once when that turn completes', async ($, on) => {
    const { ran, clock } = world(on, { rows: [SHIP] })
    const c = chat(on)
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    await ui.press({ key: 'approve' })
    await until(clock, () => ran('approve').length > 0)
    await clock.advance(6_000)
    expect(c.sent).toEqual([])
    await $.turn.complete({ turnId: 'turn-1', reason: 'answer', answer: 'done' } as never)
    await until(clock, () => c.sent.length > 0)
    expect(c.sent).toEqual([WAKE])
    await ui.unmount()
  })

  test('/cairn-approve says where it came from, and sends once the command has returned', async ($, on) => {
    const { ran, clock } = world(on, { rows: [SHIP] })
    const c = chat(on)
    await start($, WT)
    await $.command.run({ command: 'cairn-approve', args: '' })
    expect(ran('approve')).toEqual([['approve', 'ship']])
    // The engine refuses a submit made from the command's own hook, so it goes out on a later poll, once.
    await clock.advance(6_000)
    expect(c.sent).toEqual([WAKE.replace('the pane', '/cairn-approve')])
  })

  test('the chat\'s own menu answer sends nothing', async ($, on) => {
    const { ran, clock } = world(on, { rows: [row(plan({ stage: 'prd' }), WT, undefined, ready('prd'))] })
    const c = chat(on)
    await start($, WT)
    const q = 'Approve the PRD? [cairn:approve prd shop]'
    await $.tool.call({
      tool: 'AskUserQuestion',
      questions: [{ question: q, header: 'cairn', multiSelect: false, options: [{ label: 'Approve', description: 'ok' }, { label: 'Revise', description: 'no' }] }],
    } as never)
    expect(ran('approve')).toEqual([['approve', 'prd']])
    await clock.advance(10_000)
    expect(c.sent).toEqual([])
  })
})

describe('a merged plan wakes the chat once', () => {
  const merged = (over: Record<string, unknown> = {}) => ({ ...row(plan({ stage: 'learn' }), WT), prOpen: true, mergedAwaitingDone: true, ...over })

  test('the session\'s own plan sends one message, however many polls follow', async ($, on) => {
    const { w, clock } = world(on, { rows: [merged()] })
    const c = chat(on)
    await start($, WT)
    await until(clock, () => c.sent.length > 0)
    expect(c.sent).toEqual(["cairn: Acme Storefront's pull request is merged. Run cairn next in its worktree to mark its Linear issues Done."])
    w.mtimes.set(STATE, 2)
    await clock.advance(70_000)
    expect(c.sent).toHaveLength(1)
  })

  test('a plan that closed before its pull request merged still wakes the session that ran it', async ($, on) => {
    // The session works from the main checkout, as in an Orca workspace: its plan is the stored one, not its folder's.
    const open = { ...row(plan({ stage: 'learn' }), WT), prOpen: true }
    const { w, clock } = world(on, { rows: [open], cwd: '/repo' })
    const c = chat(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
    await start($, '/repo')
    // Running cairn in the plan's worktree makes it the session's plan.
    await $.tool.call({ tool: 'Bash', command: `cd ${WT} && cairn status` })
    await clock.advance(5_000)
    expect(c.sent).toEqual([])
    // Merged on GitHub: no watched file changes, so only the periodic look for an open pull request can see it.
    w.rows = [{ ...row(plan({ stage: 'closed' }), WT), prOpen: true, mergedAwaitingDone: true }]
    await clock.advance(35_000)
    await until(clock, () => c.sent.length > 0)
    expect(c.sent).toEqual(["cairn: Acme Storefront's pull request is merged. Run cairn next in its worktree to mark its Linear issues Done."])
  })

  test('a session with no plan of its own is not told about another session\'s merged plan', async ($, on) => {
    // The only plan open is shown as a guess, but this session never worked on it.
    const { clock } = world(on, { rows: [merged()], cwd: '/repo' })
    const c = chat(on)
    await start($, '/repo')
    await clock.advance(40_000)
    expect(c.sent).toEqual([])
  })

  test('another plan\'s merge, or a plan not merged, sends nothing', async ($, on) => {
    const other = '/repo/.claude/worktrees/sdlc-other'
    const { clock } = world(on, {
      rows: [merged({ mergedAwaitingDone: false }), { ...row(plan({ slug: 'other', title: 'Other', stage: 'learn' }), other), mergedAwaitingDone: true }],
    })
    const c = chat(on)
    await start($, WT)
    await clock.advance(10_000)
    expect(c.sent).toEqual([])
  })
})

describe('the running version', () => {
  test('shows in the docked bar when plugin.json names it', async ($, on) => {
    const { w } = world(on, { rows: [row(plan(), WT)] })
    w.pluginJson = JSON.stringify({ version: VERSION })
    await start($, WT)
    const ui = await mount($, 'terminal')
    expect(await drawn(ui)).toContain(`cairn ${VERSION}`)
    await ui.unmount()
  })

  test('is left out when plugin.json cannot be read', async ($, on) => {
    world(on, { rows: [row(plan(), WT)] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    expect(await drawn(ui)).not.toMatch(/cairn \d/)
    await ui.unmount()
  })
})

describe('the Build header shows the step', () => {
  const build = (stepText?: string) => ({
    ...row(plan({ phases: [{ id: 'p1', name: 'A', status: 'in_progress', tasks: [task('a', 'A', { status: 'done' })] }, { id: 'p2', name: 'B', status: 'pending', tasks: [task('b', 'B')] }, { id: 'p3', name: 'C', status: 'pending', tasks: [task('c', 'C')] }] }), WT),
    stepText,
  })

  test('after the phase text', async ($, on) => {
    world(on, { rows: [build('wrapping up phase')] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    expect(await drawn(ui)).toContain('Build · phase 1 of 3 · wrapping up phase')
    await ui.unmount()
  })

  test('without a step the header is as before', async ($, on) => {
    world(on, { rows: [build()] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    const text = await drawn(ui)
    expect(text).toContain('Build · phase 1 of 3')
    expect(text).not.toContain('wrapping')
    await ui.unmount()
  })
})
