import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { handoffFromState, pauseAge } from '../mod/pause.ts'

const RAN = { stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const WT = '/repo/.claude/worktrees/sdlc-shop'
const HANDOFF = `${WT}/docs/sdlc/plans/shop/handoff.md`
const NOW = Date.parse('2026-03-01T12:00:00.000Z')
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString()

const SLICES = [
  { id: 'cart', name: 'Secret Checkout Flow', status: 'in_progress', substep: 'reviewing', worktree: '/repo/.claude/worktrees/sdlc-slice-cart' },
  { id: 'pay', name: 'Payments', status: 'in_progress', substep: 'implementing', worktree: '/repo/.claude/worktrees/sdlc-slice-pay' },
  { id: 'done1', name: 'Done one', status: 'done' },
  { id: 'later', name: 'Later', status: 'pending' },
]

function planState(paused: unknown = null, slices: unknown[] = SLICES) {
  return { slug: 'shop', title: 'Acme Storefront Rewrite', stage: 'execute', paused, phases: [{ id: 'p1', name: 'Core', slices }] }
}

type World = {
  paused?: unknown
  slices?: unknown[]
  handoff?: string
  config?: string
  refusePause?: string
  failAbort?: boolean
  failRegister?: boolean
  failTimer?: boolean
  answer?: string
}

/** The world beneath the mod: the CLI, the plan's files, the clock, the dialog, and the turn. */
function world(on: On, w: World = {}) {
  const cli: string[][] = []
  const writes: { path: string; text: string }[] = []
  const toasts: string[] = []
  const asked: { question: string; options: readonly string[] }[] = []
  const aborts: string[] = []
  const submits: string[] = []
  const registered: string[] = []
  const order: string[] = []
  const beats: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  if (w.failTimer) {
    on('clock.now', () => ({ deny: 'clock down' }))
    on('clock.every', () => ({ value: { cancel() {} } as never }))
  } else {
    mock.clock(on, { now: NOW })
  }
  on('process.run', (_$, e) => {
    const [bin, ...args] = e.argv
    const answer = (exitCode: number, stdout: string, stderr = '') => ({ value: { ...RAN, exitCode, stdout, stderr } })
    if (bin === 'git') return answer(0, '/repo/.git\n')
    cli.push(args)
    order.push(`cairn ${args.join(' ')}`)
    if (args.join(' ') === 'status --json') {
      return answer(0, JSON.stringify({ ok: true, state: planState(w.paused, w.slices), planWorktree: WT }))
    }
    if (args[0] === 'pause') return w.refusePause === undefined ? answer(0, 'Paused "Shop".\n') : answer(2, '', `✗ Refused: ${w.refusePause}\n`)
    if (args[0] === 'resume') return answer(0, 'Resumed "Shop".\nNext: start cart\n')
    return answer(1, '', 'unexpected')
  })
  on('fs.read', (_$, e) => {
    if (e.path === HANDOFF && w.handoff !== undefined) return { value: w.handoff }
    if (e.path === `${WT}/.sdlc/config.json` && w.config !== undefined) return { value: w.config }
    return { deny: 'ENOENT: no such file' }
  })
  on('fs.write', (_$, e) => {
    if (e.path.endsWith('mod-heartbeat')) {
      beats.push(e.text)
      return { value: undefined }
    }
    writes.push({ path: e.path, text: e.text })
    order.push(`write ${e.path}`)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    for (const q of e.questions) asked.push({ question: q.question, options: q.options.map((o: { label: string }) => o.label) })
    const answers = Object.fromEntries(e.questions.map((q: { question: string }) => [q.question, w.answer ?? 'Not now']))
    return { result: { questions: e.questions, answers } as never }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.abort', (_$, e) => {
    aborts.push(e.turnId)
    return w.failAbort ? { deny: `turn ${e.turnId} is not running` } : { value: undefined }
  })
  on('prompt.submit', (_$, e) => {
    submits.push(e.text)
    return { text: e.text }
  })
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return w.failRegister ? { deny: 'name taken' } : { value: undefined }
  })
  const ran = (verb: string) => cli.filter(a => a[0] === verb)
  return { beats, cli, writes, toasts, asked, aborts, submits, registered, order, ran }
}

const PAUSE_COMMANDS = ['cairn-pause-now', 'cairn-pause-mod', 'cairn-resume-mod']
const start = ($: any) => $.session.start({ cwd: '/repo', surface: null, isInteractive: false })

test('the handoff lists running slices with substep and worktree, and keeps earlier open questions', () => {
  const existing = '# Handoff: shop\n\n## In flight\n- old (implementing): gone\n\n## Open questions\n- Which tax table? (recommended: EU)\n\n## Next action\nold\n'
  const md = handoffFromState(planState(), existing)
  expect(md).toContain('## In flight')
  expect(md).toContain('- cart (reviewing): /repo/.claude/worktrees/sdlc-slice-cart')
  expect(md).toContain('- pay (implementing): /repo/.claude/worktrees/sdlc-slice-pay')
  expect(md).not.toContain('done1')
  expect(md).not.toContain('old (implementing)')
  expect(md).toMatch(/## Open questions\n- Which tax table\? \(recommended: EU\)/)
  expect(md).toMatch(/## Next action\n\S/)
})

test('the handoff with nothing running and no earlier file still has all three sections with content', () => {
  const md = handoffFromState(planState(null, [{ id: 'a', name: 'A', status: 'pending' }]))
  expect(md).toMatch(/## In flight\n- Nothing in flight\./)
  expect(md).toMatch(/## Open questions\n- None\./)
  expect(md).toMatch(/## Next action\ncairn next --json/)
})

test('template placeholder lines in an earlier handoff are not kept as open questions', () => {
  const md = handoffFromState(planState(), '## Open questions\n- <question> (recommended: <answer>)\n')
  expect(md).toMatch(/## Open questions\n- None\./)
})

test('pauseAge is the whole minutes since paused.at; a missing or invalid one is infinitely long', () => {
  expect(pauseAge(planState({ at: minutesAgo(30), mode: 'drain' }), NOW)).toBe(30)
  expect(pauseAge(planState({ mode: 'drain' }), NOW)).toBe(Infinity)
  expect(pauseAge(planState({ at: 'nonsense', mode: 'drain' }), NOW)).toBe(Infinity)
  expect(pauseAge(planState(null), NOW)).toBe(Infinity)
})

test('drain pause writes the handoff, then runs cairn pause', async ($, on) => {
  const w = world(on)
  await start($)
  const out = await $.command.run({ command: 'cairn-pause-mod' })
  expect(w.order.slice(-2)).toEqual([`write ${HANDOFF}`, 'cairn pause'])
  expect(w.writes[0]?.text).toContain('- cart (reviewing)')
  expect(out.text).toMatch(/Paused/)
  expect(w.aborts).toEqual([])
})

test('a refused pause toasts the reason and leaves the plan alone', async ($, on) => {
  const w = world(on, { refusePause: 'handoff.md is unchanged since the last pause' })
  await start($)
  await $.command.run({ command: 'cairn-pause-mod' })
  expect(w.toasts.join('\n')).toContain('handoff.md is unchanged since the last pause')
  expect(w.ran('resume')).toEqual([])
  expect(w.ran('pause')).toEqual([['pause']])
})

test('pausing a plan that is already paused writes nothing and runs no pause', async ($, on) => {
  const w = world(on, { paused: { at: minutesAgo(5), mode: 'drain' } })
  await start($)
  await $.command.run({ command: 'cairn-pause-mod' })
  expect(w.writes).toEqual([])
  expect(w.ran('pause')).toEqual([])
  expect(w.toasts.join('\n')).toMatch(/already paused/)
})

test('Stop now with no tracked turn pauses with mode now and calls no abort (Review focus 4)', async ($, on) => {
  const w = world(on)
  await start($)
  await $.command.run({ command: 'cairn-pause-now' })
  expect(w.aborts).toEqual([])
  expect(w.submits).toEqual([])
  expect(w.ran('pause')).toEqual([['pause', '--now']])
})

test('Stop now with a running turn aborts it, submits the fixed message when that turn completes, and pauses nothing itself', async ($, on) => {
  const w = world(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 'turn-7' })
  await $.command.run({ command: 'cairn-pause-now' })
  expect(w.aborts).toEqual(['turn-7'])
  expect(w.submits).toEqual([])
  await $.turn.complete({ turnId: 'turn-7', reason: 'aborted', answer: '' } as never)
  expect(w.submits).toHaveLength(1)
  expect(w.ran('pause')).toEqual([])
})

test('Stop now message names TaskStop and substep recording but no slice or plan text (security)', async ($, on) => {
  const w = world(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 'turn-7' })
  await $.command.run({ command: 'cairn-pause-now' })
  await $.turn.complete({ turnId: 'turn-7', reason: 'aborted', answer: '' } as never)
  const text = w.submits[0] ?? ''
  expect(text).toMatch(/TaskStop/)
  expect(text).toMatch(/substep/)
  for (const leak of ['Secret Checkout Flow', 'Payments', 'Acme Storefront Rewrite', 'shop', 'cart', 'sdlc-slice']) {
    expect(text).not.toContain(leak)
  }
  expect(w.cli.filter(a => a[0] !== 'status')).toEqual([])
})

test('a turn that completes without Stop now submits nothing', async ($, on) => {
  const w = world(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 'turn-9' })
  await $.turn.complete({ turnId: 'turn-9', reason: 'answer', answer: 'done' } as never)
  expect(w.submits).toEqual([])
})

test('a rejected abort falls back to pausing with mode now and submits nothing', async ($, on) => {
  const w = world(on, { failAbort: true })
  await start($)
  await $.turn.start({ text: 'go', turnId: 'turn-7' })
  await $.command.run({ command: 'cairn-pause-now' })
  expect(w.submits).toEqual([])
  expect(w.ran('pause')).toEqual([['pause', '--now']])
})

test('a subagent turn is not tracked, and a completed main turn is forgotten', async ($, on) => {
  const w = world(on)
  await start($)
  await $.turn.start({ text: 'sub', turnId: 'turn-sub', agentId: 'agent-1' })
  await $.command.run({ command: 'cairn-pause-now' })
  expect(w.aborts).toEqual([])

  await $.turn.start({ text: 'go', turnId: 'turn-8' })
  await $.turn.complete({ turnId: 'turn-8', reason: 'answer', answer: 'done' } as never)
  await $.command.run({ command: 'cairn-pause-now' })
  expect(w.aborts).toEqual([])
  expect(w.ran('pause')).toEqual([['pause', '--now'], ['pause', '--now']])
})

test('a 30-minute pause resumes in place without asking', async ($, on) => {
  const w = world(on, { paused: { at: minutesAgo(30), mode: 'drain' } })
  await start($)
  await $.command.run({ command: 'cairn-resume-mod' })
  expect(w.asked).toEqual([])
  expect(w.ran('resume')).toEqual([['resume']])
})

test('a 3-hour pause shows /clear, then /cairn:resume with the age, and resumes only on "Resume here anyway"', async ($, on) => {
  const w = world(on, { paused: { at: minutesAgo(180), mode: 'drain' } })
  await start($)
  await $.command.run({ command: 'cairn-resume-mod' })
  expect(w.asked).toHaveLength(1)
  expect(w.asked[0]?.question).toContain('/clear, then /cairn:resume')
  expect(w.asked[0]?.question).toContain('3 h')
  expect(w.asked[0]?.options).toContain('Resume here anyway')
  expect(w.ran('resume')).toEqual([])
})

test('answering "Resume here anyway" resumes a long pause', async ($, on) => {
  const w = world(on, { paused: { at: minutesAgo(180), mode: 'drain' }, answer: 'Resume here anyway' })
  await start($)
  await $.command.run({ command: 'cairn-resume-mod' })
  expect(w.ran('resume')).toEqual([['resume']])
})

test('a pause with no paused.at is treated as long', async ($, on) => {
  const w = world(on, { paused: { mode: 'drain' } })
  await start($)
  await $.command.run({ command: 'cairn-resume-mod' })
  expect(w.asked).toHaveLength(1)
  expect(w.asked[0]?.question).toContain('/clear, then /cairn:resume')
  expect(w.ran('resume')).toEqual([])
})

test('resumeFreshAfterMinutes in .sdlc/config.json moves the threshold', async ($, on) => {
  const w = world(on, { paused: { at: minutesAgo(30), mode: 'drain' }, config: '{"resumeFreshAfterMinutes": 10}' })
  await start($)
  await $.command.run({ command: 'cairn-resume-mod' })
  expect(w.asked).toHaveLength(1)
  expect(w.ran('resume')).toEqual([])
})

test('resume with a slug runs cairn resume for that plan', async ($, on) => {
  const w = world(on)
  await start($)
  await $.command.run({ command: 'cairn-resume-mod', args: 'other' })
  expect(w.ran('resume')).toEqual([['resume', 'other']])
})

test('session start registers both commands; one failing registration does not stop the heartbeat or the session', async ($, on) => {
  const w = world(on, { failRegister: true })
  expect(await start($)).toEqual({ cwd: '/repo' })
  expect(w.beats).toEqual([String(NOW)])
  expect(w.registered.filter(n => PAUSE_COMMANDS.includes(n))).toEqual(PAUSE_COMMANDS)
})

const aborted = ($: any, turnId: string) => $.turn.complete({ turnId, reason: 'aborted', answer: '' } as never)

test('after Stop now, a different turn completing sends no message', async ($, on) => {
  const w = world(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 'turn-1' })
  await $.command.run({ command: 'cairn-pause-now' })
  await aborted($, 'turn-other')
  expect(w.submits).toEqual([])
})

test('after Stop now, a new main turn starting clears the pending message for good', async ($, on) => {
  const w = world(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 'turn-1' })
  await $.command.run({ command: 'cairn-pause-now' })
  await $.turn.start({ text: 'next', turnId: 'turn-2' })
  await aborted($, 'turn-1')
  await aborted($, 'turn-2')
  expect(w.submits).toEqual([])
})

test('after Stop now, the aborted turn completing sends the message exactly once', async ($, on) => {
  const w = world(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 'turn-1' })
  await $.command.run({ command: 'cairn-pause-now' })
  await aborted($, 'turn-1')
  await aborted($, 'turn-1')
  expect(w.submits).toHaveLength(1)
})

test('Stop now while a stop message is pending does nothing but toast', async ($, on) => {
  const w = world(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 'turn-1' })
  await $.command.run({ command: 'cairn-pause-now' })
  await $.command.run({ command: 'cairn-pause-now' })
  expect(w.aborts).toEqual(['turn-1'])
  expect(w.ran('pause')).toEqual([])
  expect(w.toasts.join('\n')).toMatch(/already stopping/)
})

test('the handoff survives null slices and non-array phases or slices', () => {
  const messy = { slug: 'shop', phases: [null, { slices: 'oops' }, { slices: [null, { id: 'ok', status: 'in_progress' }] }] }
  expect(handoffFromState(messy as never)).toContain('- ok (no substep recorded)')
  expect(handoffFromState({ slug: 'shop', phases: 'nope' } as never)).toContain('Nothing in flight')
})

test('only the template placeholder line is dropped from earlier open questions', () => {
  const md = handoffFromState(
    planState(),
    '## Open questions\n- <question> (recommended: <answer>)\n- <b>Bold</b> or not? (recommended: bold)\n',
  )
  expect(md).toContain('- <b>Bold</b> or not? (recommended: bold)')
  expect(md).not.toContain('<question>')
})

test('a resumeFreshAfterMinutes that is not a finite positive number falls back to 60', async ($, on) => {
  const w = world(on, { paused: { at: minutesAgo(90), mode: 'drain' }, config: '{"resumeFreshAfterMinutes": 1e999}' })
  await start($)
  await $.command.run({ command: 'cairn-resume-mod' })
  expect(w.asked).toHaveLength(1)
  expect(w.ran('resume')).toEqual([])
})

test('a module whose start throws does not stop the other module or the session', async ($, on) => {
  // The clock is refused, so the heartbeat's first beat throws out of its start.
  const w = world(on, { failTimer: true })
  expect(await start($)).toEqual({ cwd: '/repo' })
  expect(w.beats).toEqual([])
  expect(w.registered.filter(n => PAUSE_COMMANDS.includes(n))).toEqual(PAUSE_COMMANDS)
})
