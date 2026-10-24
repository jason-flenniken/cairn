// The world beneath the mod for pane tests: the CLI, git, the file system and the dialogs,
// plus the row builders and mount helpers each pane test file shares.
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'
export const RAN = { stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
export const MAIN = '/repo'
export const WT = '/repo/.claude/worktrees/sdlc-shop'
export const STATE = `${WT}/docs/sdlc/plans/shop/state.json`
export const HASH_FILE = '/repo/.git/cairn/mod-secret.sha256'
export const NOW = Date.parse('2026-03-01T12:00:00.000Z')
export const SURFACES = ['terminal', 'desktop'] as const

export type Ready = { kind: 'prd' | 'plan' | 'ship'; file: string; summary: string }
export type Row = {
  state: Record<string, unknown>; live: boolean; worktree?: string; next: { text: string }; stepText?: string; ready?: Ready
  level?: string; levelLabel?: string; timing?: Record<string, number> | null
}

/** A row as the CLI reports a plan that chose a level: the level, its display label, and ms per stage. */
export const withLevel = (r: Row, level: string, levelLabel: string, timing: Record<string, number> | null = null): Row => ({ ...r, level, levelLabel, timing })

/** A plan's state.json as the CLI writes it, with the fields under test overridden. */
export function plan(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1, slug: 'shop', title: 'Acme Storefront', track: 'feature', stage: 'execute', paused: null,
    approvals: {}, phases: [], evidence: {}, drift: [], log: [], ...over,
  }
}

export const task = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, covers: [], blockedBy: [], scope: [], complexity: 'standard', status: 'pending', fixRound: 0, ...over,
})

/** A `cairn status --all --json` row: live when it has a worktree. */
export function row(state: Record<string, unknown>, worktree?: string, next = `next step for ${String(state.slug)}`, ready?: Ready): Row {
  return { state, live: worktree !== undefined, worktree, next: { text: next }, stepText: stepTextOf(state), ready }
}

const STEP_WORDS: Record<string, string> = { testing: 'running tests', scanning: 'scanning for secrets', reviewing: 'reviewing', rechecking: 're-checking', approving: 'waiting on approval', 'opening-pr': 'opening the PR' }
/** The step as the CLI words it in the row (cli/src/render.ts stepText): the current stage's step only. */
function stepTextOf(state: Record<string, unknown>): string | undefined {
  const st = state.step as { stage: string; name: string; count?: number } | undefined
  if (!st || st.stage !== state.stage) return undefined
  if (st.name !== 'fixing') return STEP_WORDS[st.name] ?? st.name
  return st.count === undefined ? 'fixing' : `fixing ${st.count} finding${st.count === 1 ? '' : 's'}`
}

/** What the CLI reports for a document waiting on the human. */
export const ready = (kind: Ready['kind'], summary = `- **FR-01** the ${kind} summary`): Ready => ({ kind, file: `${WT}/docs/sdlc/plans/shop/${kind}.md`, summary })

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export type WorldInit = { rows?: Row[]; cwd?: string; placed?: true | string; answer?: string; branchGone?: boolean; isGitRepo?: boolean }

/**
 * The world beneath the mod: git names /repo/.git; `cairn status --all --json` answers `w.rows`
 * (or `w.raw` when set); stat answers the mtimes in `w.mtimes`; `cairn approve` checks the secret's
 * hash as the CLI does; `git status` answers `w.git`; the dialog answers `w.answer`, or is dismissed when it is undefined. With
 * `w.holdAsks` set, a dialog stays open until its `w.release` entry is called.
 */
export function world(on: On, init: WorldInit = {}) {
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
    holdAsks: false,
    /** `git status --porcelain=v2 --branch` output; unset, git answers as it does for the common dir. */
    git: undefined as string | undefined,
    /** `git rev-parse --absolute-git-dir --show-toplevel` output: the git dir, then the top folder. */
    gitDirs: '/repo/.git\n/repo',
    gitReads: 0,
    release: [] as (() => void)[],
    commands: [] as string[],
    aborts: [] as string[],
    secrets: [] as string[],
    files: new Map<string, string>(),
    views: [] as Record<string, unknown>[],
    viewDeny: undefined as string | undefined,
    scrolls: [] as { offset: number; by: number }[],
  }
  let onDisk: string | undefined
  const clock = mock.clock(on, { now: NOW })
  on('process.run', async (_$, e) => {
    const [bin, ...args] = e.argv
    const answer = (exitCode: number, stdout: string, stderr = '') => ({ value: { ...RAN, exitCode, stdout, stderr } })
    if (bin === 'git') {
      if (init.isGitRepo === false) return answer(128, '', 'fatal: not a git repository')
      if (args.includes('status')) {
        w.gitReads++
        if (w.git !== undefined) return answer(0, w.git)
      }
      if (args.includes('--absolute-git-dir')) return answer(0, `${w.gitDirs}\n`)
      return answer(0, '/repo/.git\n')
    }
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
    if (args[0] === 'level') {
      const given = e.init?.env?.CAIRN_APPROVER
      if (given !== undefined) w.secrets.push(given)
      if (given !== undefined && onDisk !== undefined && (await sha256(given)) === onDisk) {
        onDisk = undefined
        return answer(0, `Level raised to ${args[1]}.\n`)
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
  // The engine moving the pane's window: it takes every move.
  on('ui.scroll', (_$, e) => {
    w.scrolls.push({ offset: e.offset, by: e.by })
    return {}
  })
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
    const answered = w.answer === undefined
      ? { deny: 'The user dismissed the question.' }
      : { result: { questions: e.questions, answers: Object.fromEntries(e.questions.map((q: { question: string }) => [q.question, w.answer])) } as never }
    if (w.holdAsks) return new Promise<typeof answered>(resolve => w.release.push(() => resolve(answered)))
    return answered
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

/**
 * Waits for `done`, settling the fake clock between looks. The secret path hashes with the real crypto, which
 * finishes on its own thread and not on the clock, so a fixed number of settles can look too early.
 */
export async function until(clock: { settle: () => Promise<unknown> }, done: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !done(); i++) {
    await clock.settle()
    if (!done()) await new Promise(resolve => setTimeout(resolve, 5))
  }
}

/** Runs one of the mod's slash commands as the person typing it would. */
export const command = ($: any, name: string, args = ''): Promise<{ text?: string }> => $.command.run({ command: name, args })

export const start = ($: any, cwd: string) => $.session.start({ cwd, surface: null, isInteractive: true })

export const PANE_PROPS = {
  title: 'cairn',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

export const mount = ($: any, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: 'cairn', surface, component: 'Pane', requestId: 'cairn', props: PANE_PROPS })

/** The pane on the terminal with some of its props changed: a placement, a width, a scroll window. */
export const mountAs = ($: any, over: Record<string, unknown>) =>
  $.ui.mount({ plugin: 'cairn', surface: 'terminal', component: 'Pane', requestId: 'cairn', props: { ...PANE_PROPS, ...over } })

/** Every text the pane draws, in order, one per line. */
export async function drawn(ui: any): Promise<string> {
  return (await ui.findAll({ type: 'Text' })).map((t: { text: string }) => t.text).join('\n')
}
