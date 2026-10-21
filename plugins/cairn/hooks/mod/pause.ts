// Pause, Stop now, and resume (FR-13..FR-16): the mod writes the handoff, then asks the CLI.
import type { EngineInterface, On, ProcessRunInit, SessionStartInput } from 'claude-code'
import { cairn } from './cli.ts'

type Slice = { id: string; status?: string; substep?: string; worktree?: string }
export type PlanState = {
  slug: string
  paused?: { at?: string; mode?: string } | null
  phases?: { slices?: Slice[] }[]
}
export type Outcome = { ok: boolean; message: string }

// A hung CLI must not hold the command forever.
const quick: ProcessRunInit = { timeoutMs: 60_000 }
const FRESH_MINUTES = 60
const RESUME_HERE = 'Resume here anyway'

// What Stop now tells the model after the turn is cut. Fixed text: no plan or slice names.
const STOP_NOW_MESSAGE =
  'Stop now was requested and your last turn was cut off. Stop every running subagent with TaskStop. ' +
  "Then record each in-progress slice's current substep with `cairn slice step`, commit work in progress in each slice worktree, " +
  'and follow procedures/pause.md, finishing with `cairn pause --now`.'

// The main loop's running turn, from turn.start to turn.complete; a subagent's turns are not tracked.
let mainTurn: string | undefined
// Set once Stop now has cut a turn. The engine refuses a prompt.submit made from the command's own
// hook (it would wait on the turn the hook holds), so the message goes out when that turn completes.
let stopMessagePending = false

const sectionBody = (md: string, title: string): string => {
  const lines = md.split('\n')
  const from = lines.findIndex(l => l.trim().toLowerCase() === `## ${title}`)
  if (from < 0) return ''
  const rest = lines.slice(from + 1)
  const end = rest.findIndex(l => l.startsWith('## '))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}

const running = (state: PlanState): Slice[] =>
  (state.phases ?? []).flatMap(p => p.slices ?? []).filter(s => s.status === 'in_progress')

/** handoff.md for a plan now: running slices, the earlier file's open questions, the next action. */
export function handoffFromState(state: PlanState, existing = ''): string {
  const slices = running(state)
  const flight = slices.map(s => `- ${s.id} (${s.substep ?? 'no substep recorded'}): ${s.worktree ?? 'no worktree recorded'}`)
  const kept = sectionBody(existing, 'open questions')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l !== '' && !/^-?\s*<.*>/.test(l) && !/^-?\s*none\.?$/i.test(l))
  const next =
    slices.length > 0
      ? `Continue ${slices.map(s => s.id).join(', ')} from the recorded substeps: run \`cairn status --json\`, then \`cairn next --json\` and follow the procedure it names.`
      : 'cairn next --json, then follow the procedure it names.'
  return [
    `# Handoff: ${state.slug}`,
    '',
    '## In flight',
    ...(flight.length > 0 ? flight : ['- Nothing in flight.']),
    '',
    '## Open questions',
    ...(kept.length > 0 ? kept : ['- None.']),
    '',
    '## Next action',
    next,
    '',
  ].join('\n')
}

/** Whole minutes since the plan was paused; Infinity when paused.at is missing or unreadable. */
export function pauseAge(state: PlanState, now: number): number {
  const at = Date.parse(state.paused?.at ?? '')
  return Number.isNaN(at) ? Infinity : Math.floor((now - at) / 60_000)
}

const ageText = (minutes: number): string =>
  !Number.isFinite(minutes) ? 'an unknown time' : minutes < 60 ? `${minutes} min` : `${Math.round((minutes / 6)) / 10} h`

const said = (r: { stdout: string; stderr: string }): string => (r.stderr.trim() || r.stdout.trim())

type Plan = { state: PlanState; worktree: string }

/** The session's plan from `cairn status --json`, or why there is none. */
async function plan($: EngineInterface): Promise<Plan | string> {
  const r = await cairn($, ['status', '--json'], quick)
  const json = r.json as { state?: PlanState; planWorktree?: string } | undefined
  if (r.exitCode !== 0 || json?.state === undefined || json.planWorktree === undefined) {
    return `no active plan here: ${said(r) || 'open Claude Code in a plan worktree'}`
  }
  return { state: json.state, worktree: json.planWorktree }
}

const fail = ($: EngineInterface, message: string): Outcome => {
  $.ui.toast(`cairn: ${message}`)
  return { ok: false, message }
}

/** Writes handoff.md from the plan's state, then runs `cairn pause` (`--now` for mode now). */
export async function pause($: EngineInterface, mode: 'drain' | 'now'): Promise<Outcome> {
  const found = await plan($)
  if (typeof found === 'string') return fail($, found)
  const { state, worktree } = found
  if (state.paused) return fail($, 'the plan is already paused')
  const file = `${worktree}/docs/sdlc/plans/${state.slug}/handoff.md`
  const existing = await $.fs.read(file).catch(() => undefined)
  await $.fs.write(file, handoffFromState(state, existing))
  const r = await cairn($, mode === 'now' ? ['pause', '--now'] : ['pause'], quick)
  if (r.exitCode !== 0) return fail($, `pause refused: ${said(r)}`)
  $.ui.toast(`cairn: ${r.stdout.trim()}`)
  return { ok: true, message: r.stdout.trim() }
}

async function freshMinutes($: EngineInterface, worktree: string): Promise<number> {
  try {
    const n = (JSON.parse(await $.fs.read(`${worktree}/.sdlc/config.json`)) as { resumeFreshAfterMinutes?: unknown }).resumeFreshAfterMinutes
    return typeof n === 'number' && n > 0 ? n : FRESH_MINUTES
  } catch {
    return FRESH_MINUTES
  }
}

async function runResume($: EngineInterface, args: string[]): Promise<Outcome> {
  const r = await cairn($, args, quick)
  if (r.exitCode !== 0) return fail($, `resume refused: ${said(r)}`)
  const text = r.stdout.trim()
  $.ui.toast(`cairn: ${text.split('\n')[0]}`)
  return { ok: true, message: text }
}

/** Resumes in place when the pause is fresh; otherwise says to /clear first and offers to resume here anyway. */
export async function resume($: EngineInterface, slug?: string): Promise<Outcome> {
  if (slug !== undefined) return runResume($, ['resume', slug])
  const found = await plan($)
  if (typeof found === 'string') return fail($, found)
  const age = pauseAge(found.state, await $.clock.now())
  if (age < (await freshMinutes($, found.worktree))) return runResume($, ['resume'])
  const answer = await $.ui
    .ask(`Paused ${ageText(age)} ago. For a fresh context run /clear, then /cairn:resume. Resume here anyway?`, [RESUME_HERE, 'Not now'])
    .catch(() => undefined)
  if (answer !== RESUME_HERE) return { ok: false, message: 'Not resumed. Run /clear, then /cairn:resume.' }
  return runResume($, ['resume'])
}

/** Cuts the running turn and tells the model to wind down; with no turn, or a refused abort, just pauses. */
async function stopNow($: EngineInterface): Promise<Outcome> {
  const turnId = mainTurn
  if (turnId !== undefined) {
    try {
      await $.turn.abort({ turnId })
      mainTurn = undefined
      stopMessagePending = true
      return { ok: true, message: 'Stopped the running turn; Claude will wind down the agents.' }
    } catch {
      // The turn was already over; fall through to pausing without it.
    }
  }
  return pause($, 'now')
}

const COMMANDS = [
  { name: 'cairn-pause-now', description: 'Stop the running turn and pause the cairn plan now.', immediate: true },
  { name: 'cairn-pause-mod', description: 'Pause the cairn plan once in-flight work reaches a safe point.' },
  { name: 'cairn-resume-mod', description: 'Resume the paused cairn plan, here or after /clear.', argumentHint: '[plan]' },
] as const

export async function onSessionStart($: EngineInterface, _e: SessionStartInput): Promise<void> {
  for (const spec of COMMANDS) await $.command.register(spec).catch(() => undefined)
}

export function install(on: On): void {
  on('turn.start', (_$, e, next) => {
    if (e.agentId === undefined) mainTurn = e.turnId
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      if (e.turnId === mainTurn) mainTurn = undefined
      if (stopMessagePending) {
        stopMessagePending = false
        void $.prompt.submit({ text: STOP_NOW_MESSAGE }).catch(() => undefined)
      }
    }
    return done
  })
  on('command.run', { command: 'cairn-pause-now' }, async $ => ({ text: await pauseNowCommand($) }))
  on('command.run', { command: 'cairn-resume-mod' }, async ($, e) => ({ text: await resumeCommand($, (e.args ?? '').trim() || undefined) }))
  on('command.run', { command: 'cairn-pause-mod' }, async $ => ({ text: await pauseModCommand($) }))
}

// A failing command becomes a toast and its reason, never a throw (NFR-07).
async function pauseNowCommand($: EngineInterface): Promise<string> {
  try {
    return (await stopNow($)).message
  } catch (err) {
    return fail($, err instanceof Error ? err.message : String(err)).message
  }
}

async function pauseModCommand($: EngineInterface): Promise<string> {
  try {
    return (await pause($, 'drain')).message
  } catch (err) {
    return fail($, err instanceof Error ? err.message : String(err)).message
  }
}

async function resumeCommand($: EngineInterface, slug: string | undefined): Promise<string> {
  try {
    return (await resume($, slug)).message
  } catch (err) {
    return fail($, err instanceof Error ? err.message : String(err)).message
  }
}
