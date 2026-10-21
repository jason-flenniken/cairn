import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const RAN = { stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const MAIN = '/repo'
const WT = '/repo/.claude/worktrees/sdlc-shop'
const STATE = `${WT}/docs/sdlc/plans/shop/state.json`
const HASH_FILE = '/repo/.git/cairn/mod-secret.sha256'
const NOW = Date.parse('2026-03-01T12:00:00.000Z')
const SURFACES = ['terminal', 'desktop'] as const

type Row = { state: Record<string, unknown>; live: boolean; worktree?: string; next: { text: string } }

/** A plan's state.json as the CLI writes it, with the fields under test overridden. */
function plan(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1, slug: 'shop', title: 'Acme Storefront', track: 'feature', stage: 'execute', paused: null,
    approvals: {}, phases: [], evidence: {}, drift: [], log: [], ...over,
  }
}

const slice = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, covers: [], blockedBy: [], scope: [], complexity: 'standard', status: 'pending', fixRound: 0, ...over,
})

/** A `cairn status --all --json` row: live when it has a worktree. */
function row(state: Record<string, unknown>, worktree?: string, next = `next step for ${String(state.slug)}`): Row {
  return { state, live: worktree !== undefined, worktree, next: { text: next } }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

type WorldInit = { rows?: Row[]; cwd?: string; placed?: true | string; answer?: string; branchGone?: boolean; isGitRepo?: boolean }

/**
 * The world beneath the mod: git names /repo/.git; `cairn status --all --json` answers `w.rows`
 * (or `w.raw` when set); stat answers the mtimes in `w.mtimes`; `cairn approve` checks the secret's
 * hash as the CLI does; the dialog answers `w.answer`, or is dismissed when it is undefined.
 */
function world(on: On, init: WorldInit = {}) {
  const w = {
    rows: init.rows ?? [],
    cwd: init.cwd ?? WT,
    placed: init.placed ?? (true as true | string),
    answer: 'answer' in init ? init.answer : 'Approve',
    branchGone: init.branchGone ?? false,
    raw: undefined as string | undefined,
    mtimes: new Map<string, number>([[STATE, 1]]),
    runs: [] as string[][],
    toasts: [] as string[],
    statuses: [] as (string | undefined)[],
    opens: [] as string[],
    registered: [] as string[],
    asked: [] as { question: string; options: string[] }[],
    commands: [] as string[],
    aborts: [] as string[],
    secrets: [] as string[],
  }
  let onDisk: string | undefined
  const clock = mock.clock(on, { now: NOW })
  on('process.run', async (_$, e) => {
    const [bin, ...args] = e.argv
    const answer = (exitCode: number, stdout: string, stderr = '') => ({ value: { ...RAN, exitCode, stdout, stderr } })
    if (bin === 'git') return init.isGitRepo === false ? answer(128, '', 'fatal: not a git repository') : answer(0, '/repo/.git\n')
    if (bin === 'chmod') return answer(0, '')
    w.runs.push(args)
    if (args.join(' ') === 'status --all --json') {
      return answer(0, w.raw ?? JSON.stringify({ ok: true, message: '', plans: w.rows, modActive: true }))
    }
    if (args.join(' ') === 'status --json') {
      const here = w.rows.find(r => r.worktree === w.cwd)
      return here === undefined
        ? answer(1, JSON.stringify({ ok: false, error: 'not in a plan' }))
        : answer(0, JSON.stringify({ ok: true, state: here.state, planWorktree: here.worktree }))
    }
    if (args[0] === 'approve') {
      const given = e.init?.env?.CAIRN_APPROVER
      if (given !== undefined) w.secrets.push(given)
      if (given !== undefined && onDisk !== undefined && (await sha256(given)) === onDisk) {
        onDisk = undefined
        return answer(0, `${args[1]} approved.\n`)
      }
      return answer(2, '✗ Refused: no human proof\n')
    }
    if (args[0] === 'pause') return answer(0, 'Paused "Acme Storefront".\n')
    if (args[0] === 'resume' && args[1] !== undefined) {
      if (w.branchGone) return answer(2, '', `✗ Refused: no plan "${args[1]}": its branch sdlc/${args[1]} is gone\n`)
      const at = `/repo/.claude/worktrees/sdlc-${args[1]}`
      return answer(0, `Plan "${args[1]}" lives in ${at}. Switch into it (EnterWorktree with that path, or \`cd ${at} && claude\`), then run /cairn:resume.\n`)
    }
    if (args[0] === 'resume') return answer(0, 'Resumed "Acme Storefront".\n')
    return answer(1, '', 'unexpected')
  })
  on('fs.stat', (_$, e) => {
    const m = w.mtimes.get(e.path)
    return m === undefined
      ? { deny: `ENOENT: no such file or directory, stat '${e.path}'` }
      : { value: { kind: 'file', size: 1, mtimeMs: m, isLink: false } as never }
  })
  on('fs.read', () => ({ deny: 'ENOENT: no such file' }))
  on('fs.write', (_$, e) => {
    if (e.path === HASH_FILE) onDisk = e.text
    return { value: undefined }
  })
  on('session.cwd', () => ({ value: w.cwd }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.open', (_$, e) => {
    w.opens.push(e.id)
    return { value: w.placed === true ? { isPlaced: true as const } : { isPlaced: false as const, reason: w.placed } }
  })
  on('command.register', (_$, e) => {
    w.registered.push(e.name)
    return { value: undefined as never }
  })
  on('command.run', (_$, e) => {
    w.commands.push(e.command)
    return { text: '' }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    for (const q of e.questions) w.asked.push({ question: q.question, options: q.options.map((o: { label: string }) => o.label) })
    if (w.answer === undefined) return { deny: 'The user dismissed the question.' }
    return { result: { questions: e.questions, answers: Object.fromEntries(e.questions.map((q: { question: string }) => [q.question, w.answer])) } as never }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'shell ran it', stderr: '', interrupted: false } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.abort', (_$, e) => {
    w.aborts.push(e.turnId)
    return { value: undefined }
  })
  const ran = (verb: string) => w.runs.filter(a => a[0] === verb)
  const statusReads = () => w.runs.filter(a => a.join(' ') === 'status --all --json').length
  return { w, clock, ran, statusReads }
}

/** Runs one of the mod's slash commands as the person typing it would. */
const command = ($: any, name: string, args = ''): Promise<{ text?: string }> => $.command.run({ command: name, args })

const start = ($: any, cwd: string) => $.session.start({ cwd, surface: null, isInteractive: true })

const PANE_PROPS = {
  title: 'cairn',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

const mount = ($: any, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: 'cairn', surface, component: 'Pane', requestId: 'cairn', props: PANE_PROPS })

/** Every text the pane draws, in order, one per line. */
async function drawn(ui: any): Promise<string> {
  return (await ui.findAll({ type: 'Text' })).map((t: { text: string }) => t.text).join('\n')
}

async function buttonKeys(ui: any): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map((b: { key: string }) => b.key)
}

// The fixtures of FR-09 and FR-12: what each draws and exactly which buttons it shows.
const EXECUTE = plan({
  phases: [
    {
      id: 'p1', name: 'Core', status: 'in_progress',
      slices: [
        slice('cart', 'Cart', { status: 'in_progress', substep: 'fixing', fixRound: 2 }),
        slice('pay', 'Payments', { blockedBy: ['cart'] }),
        slice('auth', 'Auth', { status: 'done' }),
      ],
    },
    { id: 'p2', name: 'Polish', status: 'pending', slices: [slice('docs', 'Docs')] },
  ],
})

describe('pane content and buttons (FR-09, FR-12)', () => {
  for (const surface of SURFACES) {
    test(`discover: header with stage, nothing waiting, Pause and Status (${surface})`, async ($, on) => {
      world(on, { rows: [row(plan({ stage: 'discover' }), WT)] })
      await start($, WT)
      const ui = await mount($, surface)
      const text = await drawn(ui)
      expect(text).toContain('Acme Storefront')
      expect(text).toContain('Discover')
      expect(text).toMatch(/Waiting on you: nothing/)
      expect(await buttonKeys(ui)).toEqual(['pause', 'status'])
      await ui.unmount()
    })

    test(`execute: phase 1 of 2, the running slice's substep and fix round 2, the waiting slice (${surface})`, async ($, on) => {
      world(on, { rows: [row(EXECUTE, WT)] })
      await start($, WT)
      const ui = await mount($, surface)
      const text = await drawn(ui)
      expect(text).toContain('Execute')
      expect(text).toContain('phase 1 of 2')
      expect(text).toMatch(/Cart \(fixing, fix round 2\)/)
      expect(text).toMatch(/Payments \(waits on Cart\)/)
      expect(text).toContain('Auth')
      expect(text).toContain('Polish')
      expect(await buttonKeys(ui)).toEqual(['pause', 'stop', 'status'])
      await ui.unmount()
    })

    test(`six drift entries: the count and only the first five paths (${surface})`, async ($, on) => {
      const drift = [1, 2, 3, 4, 5, 6].map(n => ({ path: `src/stray${n}.ts`, at: 'x', reason: 'outside scope' }))
      world(on, { rows: [row(plan({ stage: 'verify', drift: [...drift, { path: 'src/acked.ts', at: 'x', reason: 'r', acked: { at: 'y' } }] }), WT)] })
      await start($, WT)
      const ui = await mount($, surface)
      const text = await drawn(ui)
      expect(text).toMatch(/6 unreviewed drift/)
      for (const n of [1, 2, 3, 4, 5]) expect(text).toContain(`src/stray${n}.ts`)
      expect(text).not.toContain('src/stray6.ts')
      expect(text).not.toContain('src/acked.ts')
      expect(await buttonKeys(ui)).toEqual(['pause', 'status'])
      await ui.unmount()
    })

    test(`a pending phase stop: Waiting on you names it, the last verdict shows, Approve appears (${surface})`, async ($, on) => {
      const stop = plan({
        phases: [
          { id: 'p1', name: 'Core', status: 'awaiting_approval', verdict: { result: 'yellow', at: 'x', commit: 'abc' }, slices: [slice('cart', 'Cart', { status: 'done' })] },
          { id: 'p2', name: 'Polish', status: 'pending', slices: [] },
        ],
      })
      world(on, { rows: [row(stop, WT)] })
      await start($, WT)
      const ui = await mount($, surface)
      const text = await drawn(ui)
      expect(text).toMatch(/Waiting on you: phase approval/)
      expect(text).toMatch(/Last verdict: Core: yellow/)
      expect(await buttonKeys(ui)).toEqual(['approve', 'pause', 'status'])
      await ui.unmount()
    })

    test(`a paused plan: Resume and Status, no Pause (${surface})`, async ($, on) => {
      world(on, { rows: [row(plan({ paused: { at: '2026-03-01T11:00:00.000Z', mode: 'drain' } }), WT)] })
      await start($, WT)
      const ui = await mount($, surface)
      expect(await drawn(ui)).toMatch(/Paused/)
      expect(await buttonKeys(ui)).toEqual(['resume', 'status'])
      await ui.unmount()
    })

    test(`two other plans: a line each with title, stage, next step and its own Resume (${surface})`, async ($, on) => {
      world(on, {
        rows: [
          row(plan({ stage: 'discover' }), WT),
          row(plan({ slug: 'alpha', title: 'Alpha Billing', stage: 'prd' }), undefined, 'Draft the PRD.'),
          row(plan({ slug: 'beta', title: 'Beta Search', stage: 'review' }), '/repo/.claude/worktrees/sdlc-beta', 'Review the branch.'),
          row(plan({ slug: 'old', title: 'Old Closed', stage: 'closed' }), undefined),
        ],
      })
      await start($, WT)
      const ui = await mount($, surface)
      const text = await drawn(ui)
      expect(text).toMatch(/Alpha Billing · PRD · Draft the PRD\./)
      expect(text).toMatch(/Beta Search · Review · Review the branch\./)
      expect(text).not.toContain('Old Closed')
      expect(await buttonKeys(ui)).toEqual(['pause', 'status', 'resume:alpha', 'resume:beta'])
      await ui.unmount()
    })
  }
})

test('Stop now shows within one poll of a main-loop turn starting, and goes when it completes; a subagent turn is not one', async ($, on) => {
  const { clock } = world(on, { rows: [row(plan({ stage: 'discover' }), WT)] })
  await start($, WT)
  const ui = await mount($, 'terminal')
  await $.turn.start({ text: 'sub', turnId: 'turn-sub', agentId: 'agent-1' })
  await clock.advance(2_000)
  expect(await buttonKeys(ui)).toEqual(['pause', 'status'])
  await $.turn.start({ text: 'go', turnId: 'turn-1' })
  await clock.advance(2_000)
  expect(await buttonKeys(ui)).toEqual(['pause', 'stop', 'status'])
  await $.turn.complete({ turnId: 'turn-1', reason: 'answer', answer: 'done' } as never)
  await clock.advance(2_000)
  expect(await buttonKeys(ui)).toEqual(['pause', 'status'])
  await ui.unmount()
})

describe('status line (FR-11)', () => {
  test('in a plan worktree it shows the plan summary', async ($, on) => {
    const { w } = world(on, { rows: [row(EXECUTE, WT)] })
    await start($, WT)
    expect(w.statuses.at(-1)).toBe('Acme Storefront (shop): Execute · phase 1 of 2 "Core" · 1/4 slices done · 1 running')
  })

  test('in a slice worktree it shows its plan summary too', async ($, on) => {
    const inSlice = plan({ phases: [{ id: 'p1', name: 'Core', status: 'in_progress', slices: [slice('cart', 'Cart', { status: 'in_progress', worktree: '/repo/.claude/worktrees/sdlc-shop--cart' })] }] })
    const { w } = world(on, { rows: [row(inSlice, WT)], cwd: '/repo/.claude/worktrees/sdlc-shop--cart' })
    await start($, '/repo/.claude/worktrees/sdlc-shop--cart')
    expect(w.statuses.at(-1)).toMatch(/^Acme Storefront \(shop\): /)
  })

  test('on main with two active plans it shows "2 active plans"', async ($, on) => {
    const { w } = world(on, {
      cwd: MAIN,
      rows: [row(plan(), WT), row(plan({ slug: 'beta', title: 'Beta' }), undefined), row(plan({ slug: 'old', stage: 'closed' }), undefined)],
    })
    await start($, MAIN)
    expect(w.statuses.at(-1)).toBe('2 active plans')
  })

  test('with no active plans it is cleared', async ($, on) => {
    const { w } = world(on, { cwd: MAIN, rows: [row(plan({ stage: 'closed' }), undefined)] })
    await start($, MAIN)
    expect(w.statuses).toEqual([undefined])
  })
})

describe('polling (FR-10, NFR-01)', () => {
  test('ten idle polls stat files and start no process', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(EXECUTE, WT)] })
    await start($, WT)
    const before = w.runs.length
    for (let i = 0; i < 10; i++) await clock.advance(2_000)
    expect(w.runs.length).toBe(before)
  })

  test('a changed state.json is shown within one poll, with one CLI read', async ($, on) => {
    const { w, clock, statusReads } = world(on, { rows: [row(plan({ stage: 'discover' }), WT)] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    const reads = statusReads()
    w.rows = [row(plan({ stage: 'prd' }), WT)]
    w.mtimes.set(STATE, 2)
    await clock.advance(2_000)
    expect(statusReads()).toBe(reads + 1)
    expect(await drawn(ui)).toContain('PRD')
    expect(w.statuses.at(-1)).toMatch(/: PRD$/)
    await clock.advance(2_000)
    expect(statusReads()).toBe(reads + 1)
    await ui.unmount()
  })

  test('a partial state.json keeps the last good view and is read again on the next poll (Review focus 3)', async ($, on) => {
    const { w, clock, statusReads } = world(on, { rows: [row(plan({ stage: 'discover' }), WT)] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    // Mid-write the CLI cannot parse the file, so it leaves the plan out of its list.
    w.rows = []
    w.mtimes.set(STATE, 2)
    await clock.advance(2_000)
    expect(await drawn(ui)).toContain('Discover')
    expect(await buttonKeys(ui)).toEqual(['pause', 'status'])
    // The write finished: the next poll reads again, though the mtime did not move.
    w.rows = [row(plan({ stage: 'prd' }), WT)]
    const reads = statusReads()
    await clock.advance(2_000)
    expect(statusReads()).toBe(reads + 1)
    expect(await drawn(ui)).toContain('PRD')
    await ui.unmount()
  })

  test('output that is not JSON keeps the last good view, and a second failure waits for the next change', async ($, on) => {
    const { w, clock, statusReads } = world(on, { rows: [row(plan({ stage: 'discover' }), WT)] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    w.raw = '{"ok": tr'
    w.mtimes.set(STATE, 2)
    await clock.advance(2_000)
    await clock.advance(2_000)
    const reads = statusReads()
    await clock.advance(2_000)
    await clock.advance(2_000)
    expect(statusReads()).toBe(reads)
    expect(await drawn(ui)).toContain('Discover')
    w.raw = undefined
    w.rows = [row(plan({ stage: 'plan' }), WT)]
    w.mtimes.set(STATE, 3)
    await clock.advance(2_000)
    expect(await drawn(ui)).toContain('Plan')
    await ui.unmount()
  })

  test('a new plan worktree is noticed through the worktrees folder', async ($, on) => {
    const { w, clock } = world(on, { cwd: MAIN, rows: [row(plan(), WT)] })
    w.mtimes.set('/repo/.git/worktrees', 1)
    await start($, MAIN)
    w.rows = [...w.rows, row(plan({ slug: 'beta', title: 'Beta' }), '/repo/.claude/worktrees/sdlc-beta')]
    w.mtimes.set('/repo/.git/worktrees', 2)
    await clock.advance(2_000)
    expect(w.statuses.at(-1)).toBe('2 active plans')
  })
})

describe('opening the pane (FR-08)', () => {
  test('in a plan worktree the pane opens at session start', async ($, on) => {
    const { w } = world(on, { rows: [row(plan(), WT)] })
    await start($, WT)
    expect(w.opens).toEqual(['cairn'])
    expect(w.toasts).toEqual([])
  })

  test('on main it does not open unasked', async ($, on) => {
    const { w } = world(on, { cwd: MAIN, rows: [row(plan(), WT)] })
    await start($, MAIN)
    expect(w.opens).toEqual([])
  })

  test('when the pane is not placed, the reason is a toast', async ($, on) => {
    const reason = 'an unrequested pane needs 144 columns; the terminal has 100'
    const { w } = world(on, { rows: [row(plan(), WT)], placed: reason })
    await start($, WT)
    expect(w.toasts.join('\n')).toContain(reason)
  })

  test('/cairn-pane opens it, and says why when it cannot be placed', async ($, on) => {
    const { w } = world(on, { cwd: MAIN, rows: [row(plan(), WT)] })
    await start($, MAIN)
    expect((await command($, 'cairn-pane')).text).toMatch(/open/)
    expect(w.opens).toEqual(['cairn'])
    w.placed = 'the terminal is 100 columns; a pane needs 110'
    const out = await command($, 'cairn-pane')
    expect(out.text).toContain('the terminal is 100 columns; a pane needs 110')
    expect(w.toasts.join('\n')).toContain('the terminal is 100 columns; a pane needs 110')
  })

  test('outside a git repo only the commands are registered', async ($, on) => {
    const { w } = world(on, { rows: [row(plan(), WT)], cwd: '/tmp', isGitRepo: false })
    await start($, '/tmp')
    expect(w.registered).toEqual(expect.arrayContaining(['cairn-pane', 'cairn-approve']))
    expect(w.runs).toEqual([])
    expect(w.opens).toEqual([])
  })
})

const PHASE_STOP = plan({
  phases: [{ id: 'p1', name: 'Core', status: 'awaiting_approval', slices: [slice('cart', 'Cart', { status: 'done' })] }],
})

describe('pane buttons (FR-05, FR-12, FR-17)', () => {
  test('Approve confirms with the mod\'s fixed wording, then approves once through the secret path', async ($, on) => {
    const { w, ran, clock } = world(on, { rows: [row(PHASE_STOP, WT)] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'approve' })
    await clock.settle()
    expect(w.asked).toEqual([{ question: 'Approve the phase stop of plan shop?', options: ['Approve', 'Cancel'] }])
    expect(ran('approve')).toEqual([['approve', 'phase']])
    expect(w.secrets).toHaveLength(1)
    expect(w.toasts.join('\n')).toMatch(/phase approved/)
    await ui.unmount()
  })

  test('cancelling or dismissing the confirm approves nothing', async ($, on) => {
    const { w, ran } = world(on, { rows: [row(PHASE_STOP, WT)], answer: 'Cancel' })
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'approve' })
    w.answer = undefined
    await ui.press({ key: 'approve' })
    expect(w.asked).toHaveLength(2)
    expect(ran('approve')).toEqual([])
    expect(w.toasts.join('\n')).toMatch(/not approved/)
    await ui.unmount()
  })

  test('a menu approval and a button approval back to back each use their own secret, and both land (Review focus 2)', async ($, on) => {
    const { w, ran } = world(on, {
      rows: [row(PHASE_STOP, WT), row(plan({ slug: 'beta', title: 'Beta', stage: 'prd' }), '/repo/.claude/worktrees/sdlc-beta')],
    })
    await start($, WT)
    const ui = await mount($, 'terminal')
    const q = 'Approve the PRD? [cairn:approve prd beta]'
    const menu = await $.tool.call({
      tool: 'AskUserQuestion',
      questions: [{ question: q, header: 'cairn', multiSelect: false, options: [{ label: 'Approve', description: 'ok' }, { label: 'Revise', description: 'no' }] }],
    } as never)
    await ui.press({ key: 'approve' })
    expect(ran('approve')).toEqual([['approve', 'prd'], ['approve', 'phase']])
    expect(new Set(w.secrets).size).toBe(2)
    expect(menu.context?.join()).toMatch(/prd approved/)
    expect(w.toasts.join('\n')).toMatch(/phase approved/)
    await ui.unmount()
  })

  test('Pause writes the handoff and runs cairn pause', async ($, on) => {
    const { ran } = world(on, { rows: [row(EXECUTE, WT)] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'pause' })
    expect(ran('pause')).toEqual([['pause']])
    await ui.unmount()
  })

  test('Stop now with no turn running pauses with mode now', async ($, on) => {
    const { ran } = world(on, { rows: [row(EXECUTE, WT)] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'stop' })
    expect(ran('pause')).toEqual([['pause', '--now']])
    await ui.unmount()
  })

  test('Stop now with a running turn aborts that turn', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(plan({ stage: 'discover' }), WT)] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    await clock.advance(2_000)
    await ui.press({ key: 'stop' })
    expect(w.aborts).toEqual(['turn-1'])
    await ui.unmount()
  })

  test('Resume on the paused plan runs cairn resume', async ($, on) => {
    const { ran } = world(on, { rows: [row(plan({ paused: { at: '2026-03-01T11:50:00.000Z', mode: 'drain' } }), WT)] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'resume' })
    expect(ran('resume')).toEqual([['resume']])
    await ui.unmount()
  })

  test('Status runs /cairn:status', async ($, on) => {
    const { w } = world(on, { rows: [row(plan(), WT)] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'status' })
    expect(w.commands).toEqual(['cairn:status'])
    await ui.unmount()
  })

  test('Resume on another plan runs cairn resume <slug> and shows its worktree and open command (FR-17)', async ($, on) => {
    const { w, ran } = world(on, { cwd: MAIN, rows: [row(plan({ slug: 'alpha', title: 'Alpha', stage: 'prd' }), undefined)] })
    await start($, MAIN)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'resume:alpha' })
    expect(ran('resume')).toEqual([['resume', 'alpha']])
    expect(w.toasts.join('\n')).toContain('/repo/.claude/worktrees/sdlc-alpha')
    expect(w.toasts.join('\n')).toContain('cd /repo/.claude/worktrees/sdlc-alpha && claude')
    await ui.unmount()
  })

  test('Resume on a plan whose branch is gone toasts why and reads the list again', async ($, on) => {
    const { w, statusReads } = world(on, { cwd: MAIN, rows: [row(plan({ slug: 'alpha', title: 'Alpha', stage: 'prd' }), undefined)], branchGone: true })
    await start($, MAIN)
    const ui = await mount($, 'terminal')
    const reads = statusReads()
    w.rows = []
    await ui.press({ key: 'resume:alpha' })
    expect(w.toasts.join('\n')).toMatch(/branch sdlc\/alpha is gone/)
    expect(statusReads()).toBe(reads + 1)
    expect(await buttonKeys(ui)).toEqual(['status'])
    await ui.unmount()
  })
})

describe('/cairn-approve (FR-05)', () => {
  test('with nothing waiting it refuses with "nothing is waiting" and asks nothing', async ($, on) => {
    const { w, ran } = world(on, { rows: [row(EXECUTE, WT)] })
    await start($, WT)
    const out = await command($, 'cairn-approve')
    expect(out.text).toMatch(/nothing is waiting/)
    expect(w.asked).toEqual([])
    expect(ran('approve')).toEqual([])
  })

  test('with no kind it confirms, then approves the stop waiting on this plan', async ($, on) => {
    const { w, ran } = world(on, { rows: [row(plan({ stage: 'plan' }), WT)] })
    await start($, WT)
    const out = await command($, 'cairn-approve')
    expect(w.asked.map(a => a.question)).toEqual(['Approve the plan stop of plan shop?'])
    expect(ran('approve')).toEqual([['approve', 'plan']])
    expect(out.text).toMatch(/plan approved/)
  })

  test('a kind that is not the waiting stop refuses', async ($, on) => {
    const { ran } = world(on, { rows: [row(plan({ stage: 'plan' }), WT)] })
    await start($, WT)
    const out = await command($, 'cairn-approve', 'ship')
    expect(out.text).toMatch(/waiting for plan approval, not ship/)
    expect(ran('approve')).toEqual([])
  })

  test('a word that is not a stop kind refuses', async ($, on) => {
    const { ran } = world(on, { rows: [row(plan({ stage: 'plan' }), WT)] })
    await start($, WT)
    const out = await command($, 'cairn-approve', 'everything')
    expect(out.text).toMatch(/not a stop/)
    expect(ran('approve')).toEqual([])
  })

  test('outside a plan it refuses', async ($, on) => {
    const { ran } = world(on, { cwd: MAIN, rows: [row(plan({ stage: 'plan' }), WT)] })
    await start($, MAIN)
    const out = await command($, 'cairn-approve')
    expect(out.text).toMatch(/not in a plan/)
    expect(ran('approve')).toEqual([])
  })
})

test('a throwing pane render leaves tool calls unaffected (NFR-07)', async ($, on) => {
  world(on, { rows: [row(plan(), WT)] })
  // Once the session is up, the drawing's state read fails, so the render throws.
  let isStateDown = false
  on('state.get', ($, e, next) => (isStateDown ? { deny: 'state is unavailable' } : next(e)))
  await start($, WT)
  isStateDown = true
  const drew = await mount($, 'terminal').then(() => 'drawn', (err: unknown) => String(err))
  expect(drew).not.toBe('drawn')
  const got = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(got.deny).toBeUndefined()
  expect(got.result).toEqual({ stdout: 'shell ran it', stderr: '', interrupted: false })
})
