import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { etaMs, fmtDuration, phrase } from '../mod/activity.ts'

const RAN = { stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const MAIN = '/repo'
const WT = '/repo/.claude/worktrees/sdlc-shop'
const STATE = `${WT}/docs/sdlc/plans/shop/state.json`
const HASH_FILE = '/repo/.git/cairn/mod-secret.sha256'
const NOW = Date.parse('2026-03-01T12:00:00.000Z')
const SURFACES = ['terminal', 'desktop'] as const

type Ready = { kind: 'prd' | 'plan' | 'ship'; file: string; summary: string }
type Row = { state: Record<string, unknown>; live: boolean; worktree?: string; next: { text: string }; ready?: Ready }

/** A plan's state.json as the CLI writes it, with the fields under test overridden. */
function plan(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1, slug: 'shop', title: 'Acme Storefront', track: 'feature', stage: 'execute', paused: null,
    approvals: {}, phases: [], evidence: {}, drift: [], log: [], ...over,
  }
}

const task = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, covers: [], blockedBy: [], scope: [], complexity: 'standard', status: 'pending', fixRound: 0, ...over,
})

/** A `cairn status --all --json` row: live when it has a worktree. */
function row(state: Record<string, unknown>, worktree?: string, next = `next step for ${String(state.slug)}`, ready?: Ready): Row {
  return { state, live: worktree !== undefined, worktree, next: { text: next }, ready }
}

/** What the CLI reports for a document waiting on the human. */
const ready = (kind: Ready['kind'], summary = `- **FR-01** the ${kind} summary`): Ready => ({ kind, file: `${WT}/docs/sdlc/plans/shop/${kind}.md`, summary })

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
    records: undefined as unknown[] | undefined,
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
    files: new Map<string, string>(),
    views: [] as Record<string, unknown>[],
    viewDeny: undefined as string | undefined,
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
    if (args.join(' ') === 'records --json') return answer(0, JSON.stringify({ ok: true, records: w.records ?? [] }))
    if (args.join(' ') === 'status --json') {
      const here = w.rows.find(r => r.worktree === w.cwd)
      return here === undefined
        ? answer(1, JSON.stringify({ ok: false, error: 'not in a plan' }))
        : answer(0, JSON.stringify({ ok: true, state: here.state, planWorktree: here.worktree, ready: here.ready }))
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
  on('fs.read', (_$, e) => {
    const text = w.files.get(e.path)
    return text === undefined ? { deny: 'ENOENT: no such file' } : { value: text as never }
  })
  on('ui.view', (_$, e) => {
    w.views.push(e as Record<string, unknown>)
    return { value: (w.viewDeny === undefined ? {} : { deny: w.viewDeny }) as never }
  })
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

const isCardPress = (key: string) => key === 'approval' || key.startsWith('main') || key.startsWith('agent:')
const isTab = (key: string) => key.startsWith('tab:')

/** The controls drawn; the presses on the cards themselves are listed apart by cardKeys. */
async function buttonKeys(ui: any): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map((b: { key: string }) => b.key).filter((k: string) => !isCardPress(k) && !isTab(k))
}

async function cardKeys(ui: any): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map((b: { key: string }) => b.key).filter((k: string) => isCardPress(k) && !k.includes(':status') && !k.includes(':activity'))
}

// The fixtures of FR-09 and FR-12: what each draws and exactly which buttons it shows.
const EXECUTE = plan({
  phases: [
    {
      id: 'p1', name: 'Core', status: 'in_progress',
      tasks: [
        task('cart', 'Cart', { status: 'in_progress', substep: 'fixing', fixRound: 2 }),
        task('pay', 'Payments', { blockedBy: ['cart'] }),
        task('auth', 'Auth', { status: 'done' }),
      ],
    },
    { id: 'p2', name: 'Polish', status: 'pending', tasks: [task('docs', 'Docs')] },
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
      expect(text).not.toContain('Waiting on you')
      expect(await buttonKeys(ui)).toEqual(['pause', 'status'])
      await ui.unmount()
    })

    test(`a fix plan in repro: the header reads Repro (${surface})`, async ($, on) => {
      world(on, { rows: [row(plan({ track: 'fix', stage: 'repro' }), WT)] })
      await start($, WT)
      const ui = await mount($, surface)
      const text = await drawn(ui)
      expect(text).toContain('Repro')
      expect(text).not.toContain('repro')
      await ui.unmount()
    })

    test(`execute: phase 1 of 2, progress, what is up next, no timeline (${surface})`, async ($, on) => {
      world(on, { rows: [row(EXECUTE, WT)] })
      await start($, WT)
      const ui = await mount($, surface)
      const text = await drawn(ui)
      expect(text).toContain('Build')
      expect(text).toContain('phase 1 of 2')
      expect(text).toContain('1/4 tasks · ~18m left')
      expect(text).toContain('Main session')
      expect(text).toMatch(/UP NEXT .*Payments \(waits\)/)
      for (const gone of ['◐ 1 Core', '○ 2 Polish', '✓ Auth', 'suggestion', 'fix attempt']) expect(text).not.toContain(gone)
      expect(await buttonKeys(ui)).toEqual(['pause', 'stop', 'status'])
      await ui.unmount()
    })

    test(`six drift entries: the count and only the first five paths (${surface})`, async ($, on) => {
      const drift = [1, 2, 3, 4, 5, 6].map(n => ({ path: `src/stray${n}.ts`, at: 'x', reason: 'outside scope' }))
      world(on, { rows: [row(plan({ stage: 'verify', drift: [...drift, { path: 'src/acked.ts', at: 'x', reason: 'r', acked: { at: 'y' } }] }), WT)] })
      await start($, WT)
      const ui = await mount($, surface)
      const text = await drawn(ui)
      expect(text).toMatch(/6 out-of-scope edits/)
      for (const n of [1, 2, 3, 4, 5]) expect(text).toContain(`src/stray${n}.ts`)
      expect(text).not.toContain('src/stray6.ts')
      expect(text).not.toContain('src/acked.ts')
      expect(await buttonKeys(ui)).toEqual(['pause', 'status'])
      await ui.unmount()
    })

    test(`a pending stop: Waiting on you names it above the cards, and Approve appears (${surface})`, async ($, on) => {
      world(on, { rows: [row(plan({ stage: 'prd' }), WT, undefined, ready('prd'))] })
      await start($, WT)
      const ui = await mount($, surface)
      const text = await drawn(ui)
      expect(text).toMatch(/Waiting on you: prd approval/)
      expect(text.indexOf('Waiting on you')).toBeLessThan(text.indexOf('Main session'))
      expect(await buttonKeys(ui)).toEqual(['readall', 'approve', 'pause', 'status'])
      expect((await ui.findAll({ type: 'Markdown' }))[0]?.text).toContain('FR-01')
      await ui.unmount()
    })

    test(`the PRD stage with ready absent: no Approve, no Waiting on you (${surface})`, async ($, on) => {
      world(on, { rows: [row(plan({ stage: 'prd' }), WT)] })
      await start($, WT)
      const ui = await mount($, surface)
      expect(await drawn(ui)).not.toContain('Waiting on you')
      expect(await buttonKeys(ui)).toEqual(['pause', 'status'])
      expect(await cardKeys(ui)).not.toContain('approval')
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
    expect(w.statuses.at(-1)).toBe('cairn · Build 1/4 tasks · ~18m left')
  })

  test('in a task worktree it shows its plan summary too', async ($, on) => {
    const inTask = plan({ phases: [{ id: 'p1', name: 'Core', status: 'in_progress', tasks: [task('cart', 'Cart', { status: 'in_progress', worktree: '/repo/.claude/worktrees/sdlc-shop--cart' })] }] })
    const { w } = world(on, { rows: [row(inTask, WT)], cwd: '/repo/.claude/worktrees/sdlc-shop--cart' })
    await start($, '/repo/.claude/worktrees/sdlc-shop--cart')
    expect(w.statuses.at(-1)).toMatch(/^cairn · Build/)
  })

  test('a plan kept in the main checkout does not claim the other plans\' worktrees under it', async ($, on) => {
    const rows = [row(plan({ slug: 'inplace', title: 'In Place' }), MAIN), row(plan(), WT)]
    const { w } = world(on, { rows })
    await start($, WT)
    expect(w.statuses.at(-1)).toMatch(/^cairn · Build/)
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
    expect(w.statuses.at(-1)).toBe('cairn · PRD')
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

  test('a new plan on a feature or fix branch is noticed through its refs folder, and a missing folder does not stop the poll', async ($, on) => {
    const { w, clock } = world(on, { cwd: MAIN, rows: [row(plan(), WT)] })
    w.mtimes.set('/repo/.git/refs/heads/feature', 1)
    await start($, MAIN)
    w.rows = [...w.rows, row(plan({ slug: 'gamma', title: 'Gamma' }), '/repo/.claude/worktrees/sdlc-gamma')]
    w.mtimes.set('/repo/.git/refs/heads/feature', 2)
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

  test('on main it opens for exactly one active plan', async ($, on) => {
    const { w } = world(on, { cwd: MAIN, rows: [row(plan(), WT)] })
    await start($, MAIN)
    expect(w.opens).toEqual(['cairn'])
  })

  test('on main with several active plans it still opens', async ($, on) => {
    const { w } = world(on, { cwd: MAIN, rows: [row(plan(), WT), row(plan({ slug: 'beta' }), '/repo/.claude/worktrees/sdlc-beta')] })
    await start($, MAIN)
    expect(w.opens).toEqual(['cairn'])
  })

  test('when the pane is not placed, the reason is a toast', async ($, on) => {
    const reason = 'an unrequested pane needs 144 columns; the terminal has 100'
    const { w } = world(on, { rows: [row(plan(), WT)], placed: reason })
    await start($, WT)
    expect(w.toasts.join('\n')).toContain(reason)
  })

  test('/cairn-pane opens it, and says why when it cannot be placed', async ($, on) => {
    const { w } = world(on, { cwd: MAIN, rows: [row(plan(), WT), row(plan({ slug: 'beta' }), undefined)] })
    await start($, MAIN)
    expect((await command($, 'cairn-pane')).text).toMatch(/open/)
    expect(w.opens).toEqual(['cairn', 'cairn'])
    w.placed = 'the terminal is 100 columns; a pane needs 110'
    const out = await command($, 'cairn-pane')
    expect(out.text).toContain('the terminal is 100 columns; a pane needs 110')
    expect(w.toasts.join('\n')).toContain('the terminal is 100 columns; a pane needs 110')
  })

  test('outside a git repo it opens with no plan reads', async ($, on) => {
    const { w } = world(on, { rows: [row(plan(), WT)], cwd: '/tmp', isGitRepo: false })
    await start($, '/tmp')
    expect(w.registered).toEqual(expect.arrayContaining(['cairn-pane', 'cairn-approve']))
    expect(w.runs).toEqual([])
    expect(w.opens).toEqual(['cairn'])
  })
})

const SHIP_STOP = plan({ stage: 'ship' })
const shipRow = () => row(SHIP_STOP, WT, undefined, ready('ship'))

describe('pane buttons (FR-05, FR-12, FR-17)', () => {
  test('Approve confirms with the mod\'s fixed wording, then approves once through the secret path', async ($, on) => {
    const { w, ran, clock } = world(on, { rows: [shipRow()] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'approve' })
    await clock.settle()
    expect(w.asked).toEqual([{ question: 'Approve the ship stop of plan shop?', options: ['Cancel', 'Approve'] }])
    expect(ran('approve')).toEqual([['approve', 'ship']])
    expect(w.secrets).toHaveLength(1)
    expect(w.toasts.join('\n')).toMatch(/ship approved/)
    await ui.unmount()
  })

  test('cancelling or dismissing the confirm approves nothing', async ($, on) => {
    const { w, ran } = world(on, { rows: [shipRow()], answer: 'Cancel' })
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
      rows: [shipRow(), row(plan({ slug: 'beta', title: 'Beta', stage: 'prd' }), '/repo/.claude/worktrees/sdlc-beta', undefined, ready('prd'))],
    })
    await start($, WT)
    const ui = await mount($, 'terminal')
    const q = 'Approve the PRD? [cairn:approve prd beta]'
    const menu = await $.tool.call({
      tool: 'AskUserQuestion',
      questions: [{ question: q, header: 'cairn', multiSelect: false, options: [{ label: 'Approve', description: 'ok' }, { label: 'Revise', description: 'no' }] }],
    } as never)
    await ui.press({ key: 'approve' })
    expect(ran('approve')).toEqual([['approve', 'prd'], ['approve', 'ship']])
    expect(new Set(w.secrets).size).toBe(2)
    expect(menu.context?.join()).toMatch(/prd approved/)
    expect(w.toasts.join('\n')).toMatch(/ship approved/)
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
    expect(out.text).toMatch(/nothing is ready/)
    expect(w.asked).toEqual([])
    expect(ran('approve')).toEqual([])
  })

  test('with no kind it confirms, then approves the stop waiting on this plan', async ($, on) => {
    const { w, ran } = world(on, { rows: [row(plan({ stage: 'plan' }), WT, undefined, ready('plan'))] })
    await start($, WT)
    const out = await command($, 'cairn-approve')
    expect(w.asked.map(a => a.question)).toEqual(['Approve the plan stop of plan shop?'])
    expect(ran('approve')).toEqual([['approve', 'plan']])
    expect(out.text).toMatch(/plan approved/)
  })

  test('a kind that is not the waiting stop refuses', async ($, on) => {
    const { ran } = world(on, { rows: [row(plan({ stage: 'plan' }), WT, undefined, ready('plan'))] })
    await start($, WT)
    const out = await command($, 'cairn-approve', 'ship')
    expect(out.text).toMatch(/waiting for plan approval, not ship/)
    expect(ran('approve')).toEqual([])
  })

  test('a word that is not a stop kind refuses', async ($, on) => {
    const { ran } = world(on, { rows: [row(plan({ stage: 'plan' }), WT, undefined, ready('plan'))] })
    await start($, WT)
    const out = await command($, 'cairn-approve', 'everything')
    expect(out.text).toMatch(/not a stop/)
    expect(ran('approve')).toEqual([])
  })

  test('with no active plan it refuses', async ($, on) => {
    const { ran } = world(on, { cwd: MAIN, rows: [row(plan({ stage: 'closed' }), WT)] })
    await start($, MAIN)
    const out = await command($, 'cairn-approve')
    expect(out.text).toMatch(/not in a plan/)
    expect(ran('approve')).toEqual([])
  })
})

describe('approval card and pressable cards (FR-11..FR-14)', () => {
  const PRD_FILE = `${WT}/docs/sdlc/plans/shop/prd.md`

  test('Read all shows the file text through Markdown, and Close takes it away again', async ($, on) => {
    const { w } = world(on, { rows: [row(plan({ stage: 'prd' }), WT, undefined, ready('prd'))] })
    w.files.set(PRD_FILE, '# The PRD\n\n- FR-01 whole document line')
    await start($, WT)
    const ui = await mount($, 'terminal')
    const shown = async () => (await ui.findAll({ type: 'Markdown' })).map((m: { text: string }) => m.text)
    expect(await shown()).toEqual(['- **FR-01** the prd summary'])
    await ui.press({ key: 'readall' })
    expect(await shown()).toEqual(['- **FR-01** the prd summary', '# The PRD\n\n- FR-01 whole document line'])
    await ui.press({ key: 'readall' })
    expect(await shown()).toEqual(['- **FR-01** the prd summary'])
    await ui.unmount()
  })

  test('Read all says so when the file cannot be read', async ($, on) => {
    world(on, { rows: [row(plan({ stage: 'prd' }), WT, undefined, ready('prd'))] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'readall' })
    expect((await ui.findAll({ type: 'Markdown' })).map((m: { text: string }) => m.text).join()).toContain(`Could not read ${PRD_FILE}`)
    await ui.unmount()
  })

  test('Approve on a ready card approves once through the secret path', async ($, on) => {
    const { w, ran, clock } = world(on, { rows: [row(plan({ stage: 'prd' }), WT, undefined, ready('prd'))] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'approve' })
    await clock.settle()
    expect(ran('approve')).toEqual([['approve', 'prd']])
    expect(w.secrets).toHaveLength(1)
    await ui.unmount()
  })

  test('pressing an agent card views that agent; the Main and approval cards view the main conversation', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(plan({ stage: 'prd' }), WT, undefined, ready('prd'))] })
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'agent-1' }))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.agent.spawn({ prompt: 'p', description: 'Draft the PRD', subagentType: 'cairn:implementer' })
    await clock.advance(1_000)
    expect(await cardKeys(ui)).toEqual(['approval', 'main', 'agent:agent-1'])
    await ui.press({ key: 'agent:agent-1' })
    await ui.press({ key: 'main' })
    await ui.press({ key: 'approval' })
    expect(w.views).toEqual([{ agentId: 'agent-1' }, {}, {}])
    await ui.unmount()
  })

  test('a refused view is a toast, not a throw', async ($, on) => {
    const { w } = world(on, { rows: [row(EXECUTE, WT)] })
    w.viewDeny = 'no agent holds that id'
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'main' })
    expect(w.toasts.join()).toContain('no agent holds that id')
    await ui.unmount()
  })
})

describe('History tab (FR-07)', () => {
  test('shows every plan log entry, newest first, in the stage color', async ($, on) => {
    const log = Array.from({ length: 12 }, (_, i) => ({ at: `2026-03-01T12:${String(i).padStart(2, '0')}:00.000Z`, event: 'task done', detail: `t-${String(i + 1).padStart(2, '0')}` }))
    world(on, { rows: [row(plan({ ...EXECUTE, log }), WT)] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'tab:history' })
    const text = await drawn(ui)
    for (let i = 1; i <= 12; i++) expect(text).toContain(`Task done: t-${String(i).padStart(2, '0')}`)
    expect(text.indexOf('Task done: t-12')).toBeLessThan(text.indexOf('Task done: t-01'))
    expect(text.indexOf('Task done: t-12')).toBeLessThan(text.indexOf('Task done: t-11'))
    const inStage = (await ui.findAll({ type: 'Text' })).filter((n: { props: { color?: string } }) => n.props.color === 'yellowBright').map((t: { text: string }) => t.text)
    expect(inStage.some((t: string) => t.endsWith('Task done: t-12'))).toBe(true)
    expect(inStage.length).toBe(12)
    await ui.unmount()
  })

  test('an agent finish appears in the timeline with its time', async ($, on) => {
    world(on, { rows: [row(EXECUTE, WT)] })
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'agent-1' }))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.agent.spawn({ prompt: 'p', description: 'Build · Pane cards', subagentType: 'cairn:implementer' })
    await $.turn.start({ text: 'p', turnId: 't1', agentId: 'agent-1' })
    await $.turn.complete({ turnId: 't1', agentId: 'agent-1', reason: 'answer', answer: 'done', durationMs: 372_000, usage: { input_tokens: 40_000, output_tokens: 2_000 } } as never)
    await ui.press({ key: 'tab:history' })
    expect(await drawn(ui)).toMatch(/\d{2}:\d{2} Finished /)
    await ui.unmount()
  })
})

describe('agent cards', () => {
  test('a spawned agent gets a card with its steps and action; it finishes green, lingers, then drops off', async ($, on) => {
    const { clock } = world(on, { rows: [row(EXECUTE, WT)] })
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'agent-1' }))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.agent.spawn({ prompt: 'p', description: 'Build · Pane cards', subagentType: 'cairn:implementer' })
    await $.turn.start({ text: 'p', turnId: 't1', agentId: 'agent-1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'agent-1' } as never)
    await clock.advance(1_000)
    let text = await drawn(ui)
    expect(text).toContain('Build · Pane cards')
    expect(text).toContain('sonnet')
    expect(text).toContain('● working')
    expect(text).toContain('1 step')
    expect(text).not.toContain('1 steps')
    await $.turn.complete({ turnId: 't1', agentId: 'agent-1', reason: 'answer', answer: 'done', durationMs: 372_000, usage: { input_tokens: 40_000, output_tokens: 2_000 } } as never)
    text = await drawn(ui)
    expect(text).toContain('✓ finished · 6m 12s · 42k tokens')
    await clock.advance(11_000)
    expect(await drawn(ui)).not.toContain('✓ finished')
    await ui.unmount()
  })

  test('the status line counts working agents', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(EXECUTE, WT)] })
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'agent-1' }))
    await start($, WT)
    await $.agent.spawn({ prompt: 'p', description: 'Build · Cart', subagentType: 'cairn:implementer' })
    await clock.advance(2_000)
    expect(w.statuses.at(-1)).toBe('cairn · Build 1/4 tasks · 1 working · ~18m left')
  })

  test('a closed plan still opens the pane, showing no plan in progress', async ($, on) => {
    const { w } = world(on, { rows: [row(plan({ stage: 'closed' }), WT)] })
    await start($, WT)
    expect(w.opens).toEqual(['cairn'])
  })
})

describe('tool phrases and ETA', () => {
  test('phrase names what a tool call does in plain words', () => {
    expect(phrase({ tool: 'Edit', file_path: '/repo/plugins/cairn/hooks/mod/pane.tsx' })).toBe('editing mod/pane.tsx')
    expect(phrase({ tool: 'Read', file_path: 'a.ts' })).toBe('reading a.ts')
    expect(phrase({ tool: 'Grep' })).toBe('searching')
    expect(phrase({ tool: 'Bash', command: 'npm test -- --watch' })).toBe('running tests')
    expect(phrase({ tool: 'Bash', command: 'git merge sdlc/x' })).toBe('merging')
    expect(phrase({ tool: 'Bash', command: 'cairn status --json' })).toBe('updating the plan')
    expect(phrase({ tool: 'Bash', command: 'ls -la /a/very/long/path/that/goes/on/and/on/and/on' })).toBe('ls -la /a/very/long/path/that/goes/on/an')
    expect(phrase({ tool: 'Agent' })).toBe('starting an agent')
    expect(phrase({ tool: 'WebFetch' })).toBe('webfetch')
  })

  test('etaMs uses the median of done tasks by complexity, less what running tasks have spent, over the lanes', () => {
    const min = 60_000
    const at = (m: number) => new Date(Date.parse('2026-03-01T10:00:00.000Z') + m * min).toISOString()
    const tasks = [
      { id: 'a', status: 'done', complexity: 'standard', startedAt: at(0), doneAt: at(10) },
      { id: 'b', status: 'done', complexity: 'standard', startedAt: at(0), doneAt: at(20) },
      { id: 'c', status: 'in_progress', complexity: 'standard', startedAt: at(20) },
      { id: 'd', status: 'pending', complexity: 'simple', blockedBy: ['c'] },
      { id: 'e', status: 'pending', complexity: 'complex', blockedBy: [] },
    ]
    // standard median 15m, 5m spent on c -> 10m; d 5m (simple fallback); e 25m (complex fallback); 2 lanes (c running, e ready).
    expect(etaMs(tasks, Date.parse(at(25)))).toBe(((10 + 5 + 25) * min) / 2)
    expect(etaMs([{ status: 'done' }], 0)).toBe(0)
  })

  test('fmtDuration reads 6m 12s, 45s and 1h 05m', () => {
    expect(fmtDuration(372_000)).toBe('6m 12s')
    expect(fmtDuration(45_000)).toBe('45s')
    expect(fmtDuration(3_900_000)).toBe('1h 05m')
    expect(fmtDuration(2_400_000, true)).toBe('40m')
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

describe('tabs and the Now view (FR-01..FR-06, FR-19)', () => {
  /** Registers the spawn answer; call before the first use of $. */
  const ids = (on: On, list: string[]) => {
    let n = 0
    on('agent.spawn', () => ({ model: 'sonnet', agentId: list[n++] ?? 'x' }))
  }
  const spawn = async ($: any, ids: string[]) => {
    for (const id of ids) await $.agent.spawn({ prompt: 'p', description: `Build · ${id}`, subagentType: 'cairn:implementer' })
  }

  test('the pane opens on Now with a tab row; each tab shows its content', async ($, on) => {
    world(on, { rows: [row(EXECUTE, WT)] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    expect((await ui.findAll({ type: 'Button' })).map((b: { key: string }) => b.key).filter(isTab)).toEqual(['tab:now', 'tab:history', 'tab:records'])
    expect(await drawn(ui)).toContain('Main session')
    await ui.press({ key: 'tab:history' })
    expect(await drawn(ui)).not.toContain('History is coming')
    expect(await drawn(ui)).not.toContain('Main session')
    await ui.press({ key: 'tab:records' })
    expect(await drawn(ui)).toContain('No finished plans yet.')
    await ui.press({ key: 'tab:now' })
    expect(await drawn(ui)).toContain('Main session')
    await ui.unmount()
  })

  test('Main session is the first card, above both working agents', async ($, on) => {
    const { clock } = world(on, { rows: [row(EXECUTE, WT)] })
    ids(on, ['agent-1', 'agent-2'])
    await start($, WT)
    const ui = await mount($, 'terminal')
    await spawn($, ['agent-1', 'agent-2'])
    await clock.advance(1_000)
    expect(await cardKeys(ui)).toEqual(['main', 'agent:agent-1', 'agent:agent-2'])
    await ui.unmount()
  })

  test('an agent card is 3 lines before, during and after a tool call, and every line views that agent', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(EXECUTE, WT)] })
    ids(on, ['agent-1'])
    await start($, WT)
    const ui = await mount($, 'terminal')
    await spawn($, ['agent-1'])
    await clock.advance(1_000)
    const cardLines = async () => (await ui.findAll({ type: 'Button' })).map((b: { key: string }) => b.key).filter((k: string) => k.startsWith('agent:agent-1'))
    const expected = ['agent:agent-1', 'agent:agent-1:status', 'agent:agent-1:activity']
    expect(await cardLines()).toEqual(expected)
    await $.turn.start({ text: 'p', turnId: 't1', agentId: 'agent-1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'agent-1' } as never)
    await clock.advance(1_000)
    expect(await cardLines()).toEqual(expected)
    for (const key of expected) await ui.press({ key })
    expect(w.views).toEqual([{ agentId: 'agent-1' }, { agentId: 'agent-1' }, { agentId: 'agent-1' }])
    await ui.unmount()
  })

  const COLORS: [string, string][] = [
    ['discover', 'cyan'], ['repro', 'red'], ['prd', 'magenta'], ['plan', 'blue'], ['execute', 'yellowBright'],
    ['verify', 'greenBright'], ['review', 'magentaBright'], ['ship', 'cyanBright'], ['learn', 'blueBright'],
  ]
  for (const [stage, color] of COLORS) {
    test(`${stage}: the header, bar and a working card's border use ${color}`, async ($, on) => {
      const done = task('a', 'A', { status: 'done' })
      const { clock } = world(on, { rows: [row(plan({ stage, phases: [{ id: 'p1', name: 'Core', status: 'in_progress', tasks: [done] }] }), WT)] })
    ids(on, ['agent-1'])
      await start($, WT)
      const ui = await mount($, 'terminal')
      await spawn($, ['agent-1'])
      await clock.advance(1_000)
      const inColor = (await ui.findAll({ type: 'Text' })).filter((n: { props: { color?: string } }) => n.props.color === color).map((t: { text: string }) => t.text)
      expect(inColor.some((t: string) => t.includes('Acme Storefront'))).toBe(true)
      expect(inColor.some((t: string) => t.includes('1/1 tasks'))).toBe(true)
      expect((await ui.findAll({ type: 'Box' })).filter((n: { props: { borderColor?: string } }) => n.props.borderColor === color)).toHaveLength(1)
      await ui.unmount()
    })
  }

  test('Now shows neither the timeline nor a follow-up count', async ($, on) => {
    const { clock } = world(on, { rows: [{ ...row(EXECUTE, WT), openSuggestions: 3 } as Row] })
    ids(on, ['agent-1'])
    await start($, WT)
    const ui = await mount($, 'terminal')
    await spawn($, ['agent-1'])
    await clock.advance(1_000)
    expect(await drawn(ui)).not.toMatch(/suggestion|follow-up|Core|Polish/)
    await ui.unmount()
  })

  test('with no ready value there is no stop card and no waiting text', async ($, on) => {
    world(on, { rows: [row(plan({ stage: 'prd' }), WT, 'Draft the PRD.')] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    expect(await drawn(ui)).not.toMatch(/Waiting on you/i)
    expect(await cardKeys(ui)).not.toContain('approval')
    await ui.unmount()
  })
})

describe('Records tab (FR-08, FR-09)', () => {
  const rec = (slug: string, date: string, over: Record<string, unknown> = {}) => ({
    slug, title: `Plan ${slug}`, date, stage: 'closed', why: `why ${slug}`, record: `/repo/docs/sdlc/plans/${slug}/RECORD.md`, followUps: [], ...over,
  })

  test('lists the plans as given, in progress first, each with date, name and why; none before a press', async ($, on) => {
    const { w, statusReads, ran } = world(on, { rows: [row(EXECUTE, WT)] })
    w.records = [rec('live', '2026-10-21', { stage: 'execute', record: undefined }), rec('newer', '2026-10-20'), rec('older', '2026-09-03')]
    await start($, WT)
    const ui = await mount($, 'terminal')
    expect(ran('records')).toEqual([])
    await ui.press({ key: 'tab:records' })
    expect(ran('records')).toHaveLength(1)
    const text = await drawn(ui)
    expect(text.indexOf('In progress · Plan live')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('In progress · Plan live')).toBeLessThan(text.indexOf('Oct 20 · Plan newer'))
    expect(text.indexOf('Oct 20 · Plan newer')).toBeLessThan(text.indexOf('Sep 3 · Plan older'))
    expect(text).toContain('why older')
    expect(statusReads()).toBeGreaterThan(0)
    await ui.unmount()
  })

  test('with no records it says so', async ($, on) => {
    world(on, { rows: [row(EXECUTE, WT)] })
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'tab:records' })
    expect(await drawn(ui)).toContain('No finished plans yet.')
    await ui.unmount()
  })

  test('opening a record shows its text and open follow-ups; Back returns to the list', async ($, on) => {
    const { w } = world(on, { rows: [row(EXECUTE, WT)] })
    w.records = [rec('a', '2026-10-20', { followUps: [{ text: 'tidy the cache', area: 'quality', status: 'open' }, { text: 'old thing', area: 'docs', status: 'done' }] }), rec('b', '2026-09-03')]
    w.files.set('/repo/docs/sdlc/plans/a/RECORD.md', '# Record A\n\nit shipped')
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'tab:records' })
    await ui.press({ key: 'record:a' })
    const md = (await ui.findAll({ type: 'Markdown' })).map((m: { text: string }) => m.text)
    expect(md[0]).toBe('# Record A\n\nit shipped')
    expect(md[1]).toContain('tidy the cache')
    expect(md[1]).not.toContain('old thing')
    await ui.press({ key: 'back' })
    expect(await drawn(ui)).toContain('Plan b')
    expect(await ui.findAll({ type: 'Markdown' })).toHaveLength(0)
    await ui.unmount()
  })

  test('a closed plan without a record says so', async ($, on) => {
    const { w } = world(on, { rows: [row(EXECUTE, WT)] })
    w.records = [rec('gone', '2026-10-20', { record: undefined })]
    await start($, WT)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'tab:records' })
    await ui.press({ key: 'record:gone' })
    expect(await drawn(ui)).toContain('No record for this plan.')
    await ui.unmount()
  })

  test('a dated plan folder is watched through dir', async ($, on) => {
    const { w } = world(on, { rows: [{ ...row(EXECUTE, WT), dir: `${WT}/docs/sdlc/plans/2026-10-21-shop` } as Row] })
    w.mtimes.set(`${WT}/docs/sdlc/plans/2026-10-21-shop/state.json`, 1)
    await start($, WT)
    expect(w.runs.filter(a => a[0] === 'status')).toHaveLength(1)
  })
})
