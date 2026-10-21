// The live pane and status line (FR-08..FR-12, FR-05, FR-17). Every 2 s the mod stats the plans'
// state files and re-reads `cairn status --all --json` only when one changed (NFR-01).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, ProcessRunInit, SessionStartInput, Timer } from 'claude-code'
import type { CairnPlanRow, CairnPlanState, CairnView } from '../../types/index.d.ts'
import { approveAs, waitingStop, type Kind, type PlanState as StopState } from './approve.ts'
import { cairn } from './cli.ts'
import { commonDir } from './heartbeat.ts'
import { pause, pickCurrent, plan, resume, stopNow, turnRunning } from './pause.ts'

type Task = { id?: string; name?: string; status?: string; substep?: string; fixRound?: number; blockedBy?: unknown; worktree?: string }
type Phase = { name?: string; status?: string; tasks?: unknown; verdict?: { result?: string } }
type Drift = { path?: string; acked?: unknown }

// What the drawing reads lives in $.state, so a hot reload keeps the view.
const view = atom({ plugin: 'cairn', key: 'view' } as const, null as CairnView | null)
const isTurnRunning = atom({ plugin: 'cairn', key: 'isTurnRunning' } as const, false)

const PANE = 'cairn'
const EVERY_MS = 2_000
const DRIFT_SHOWN = 5
const APPROVE = 'Approve'
const KINDS: readonly string[] = ['prd', 'plan', 'phase', 'ship']
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const quick: ProcessRunInit = { timeoutMs: 60_000 }

const STAGE_LABEL: Record<string, string> = {
  discover: 'Discover', repro: 'Repro', prd: 'PRD', plan: 'Plan', execute: 'Build', verify: 'Check',
  review: 'Review', ship: 'Ship', learn: 'Learn', closed: 'Closed',
}

const COMMANDS = [
  { name: 'cairn-pane', description: 'Show the cairn plan pane.' },
  {
    name: 'cairn-approve',
    description: 'Approve the stop this cairn plan is waiting on, after a confirm.',
    argumentHint: '[prd|plan|phase|ship]',
  },
] as const

const list = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x.filter(v => v !== null && typeof v === 'object') as T[]) : [])
const phasesOf = (s: CairnPlanState) => list<Phase>(s.phases)
const tasksOf = (s: CairnPlanState) => phasesOf(s).flatMap(p => list<Task>(p.tasks))
const openDrift = (s: CairnPlanState) => list<Drift>(s.drift).filter(d => !d.acked)
const stageOf = (s: CairnPlanState) => STAGE_LABEL[s.stage ?? ''] ?? String(s.stage ?? '?')
const isActive = (r: CairnPlanRow) => r.state.stage !== 'closed'
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Where the plan stands, as the CLI's progress() puts it. */
function progress(s: CairnPlanState): string {
  const phases = phasesOf(s)
  if (phases.length === 0) return stageOf(s)
  const tasks = tasksOf(s)
  const done = tasks.filter(x => x.status === 'done').length
  const running = tasks.filter(x => x.status === 'in_progress').length
  const at = phases.findIndex(p => p.status !== 'done')
  const phase = at < 0 ? 'all phases done' : `phase ${at + 1} of ${phases.length} "${phases[at]?.name ?? ''}"`
  return `${stageOf(s)} · ${phase} · ${done}/${tasks.length} tasks done${running ? ` · ${running} running` : ''}`
}

/** The plan's one-line summary, as the CLI's summary() puts it. */
function summary(s: CairnPlanState): string {
  const drift = openDrift(s).length
  return `${s.title ?? s.slug} (${s.slug}): ${progress(s)}${s.paused ? ' · PAUSED' : ''}${drift ? ` · ${drift} unreviewed drift` : ''}`
}

const isUnder = (cwd: string, dir: string | undefined) => !!dir && (cwd === dir || cwd.startsWith(`${dir}/`))

/**
 * The plan whose worktree, or one of whose task worktrees, holds the session: the deepest match, since a
 * plan kept in the main checkout holds every other plan's worktree under it.
 */
function hereSlug(plans: CairnPlanRow[], cwd: string): string | undefined {
  let best: { slug: string; depth: number } | undefined
  for (const r of plans) {
    for (const dir of [r.worktree, ...tasksOf(r.state).map(x => x.worktree)]) {
      if (isUnder(cwd, dir) && (best === undefined || dir!.length > best.depth)) best = { slug: r.state.slug, depth: dir!.length }
    }
  }
  return best?.slug
}

const stateFile = (r: CairnPlanRow) => `${r.worktree}/docs/sdlc/plans/${r.state.slug}/state.json`

// Poll bookkeeping. Nothing here is drawn, and a reload's session.start sets it up again.
let ticking: Timer | undefined
let common: string | undefined
let seen: string | undefined
let isRetrying = false
let isPolling = false

/** Every plan from the CLI, or undefined when the read failed. */
async function readPlans($: EngineInterface): Promise<CairnPlanRow[] | undefined> {
  const r = await cairn($, ['status', '--all', '--json'], quick).catch(() => undefined)
  if (r?.exitCode !== 0 || r.json?.ok !== true || !Array.isArray(r.json.plans)) return undefined
  return list<CairnPlanRow>(r.json.plans).filter(p => typeof p.state?.slug === 'string')
}

/** The files whose modification times say a plan changed: live state files, plan branches, worktrees. */
function watched(plans: CairnPlanRow[]): string[] {
  return [...plans.filter(r => r.worktree).map(stateFile), `${common}/refs/heads/sdlc`, `${common}/worktrees`]
}

async function signature($: EngineInterface, paths: string[]): Promise<string> {
  const stamps = await Promise.all(paths.map(p => $.fs.stat(p).then(s => `${p}@${s.mtimeMs}`, () => `${p}@-`)))
  return stamps.join('\n')
}

function showStatus($: EngineInterface, v: CairnView): void {
  const here = v.isFallback ? undefined : v.plans.find(r => r.state.slug === v.here)
  const active = v.plans.filter(isActive).length
  $.ui.status(here ? summary(here.state) : active > 0 ? `${active} active plan${active === 1 ? '' : 's'}` : undefined)
}

/** Re-reads every plan into the view; false, keeping the last good view, when the read failed. */
async function refresh($: EngineInterface): Promise<boolean> {
  const plans = await readPlans($)
  if (plans === undefined) return false
  // The CLI skips a state.json it cannot parse, so a live plan gone while its file is there was read mid-write.
  for (const old of (await read($, view))?.plans ?? []) {
    if (!old.worktree || plans.some(p => p.state.slug === old.state.slug)) continue
    if (await $.fs.stat(stateFile(old)).then(() => true, () => false)) return false
  }
  const located = hereSlug(plans, await $.session.cwd())
  const next: CairnView = located !== undefined
    ? { plans, here: located }
    : { plans, here: pickCurrent(plans)?.state.slug, isFallback: true }
  await update($, view, () => next)
  showStatus($, next)
  return true
}

/** One poll: stats only, and one read when something changed. A failed read is retried once, next poll. */
async function poll($: EngineInterface): Promise<void> {
  if (isPolling || common === undefined) return
  isPolling = true
  try {
    // Stop now follows the main loop's turn, which pause.ts tracks; a change redraws the pane.
    const isRunning = turnRunning()
    if ((await read($, isTurnRunning)) !== isRunning) await update($, isTurnRunning, () => isRunning)
    const before = watched((await read($, view))?.plans ?? [])
    const stamp = await signature($, before)
    if (stamp === seen && !isRetrying) return
    if (await refresh($)) {
      isRetrying = false
      const after = watched((await read($, view))?.plans ?? [])
      seen = after.join('\n') === before.join('\n') ? stamp : await signature($, after)
    } else {
      // Twice failed: wait for the next change rather than run the CLI every poll.
      if (isRetrying) seen = stamp
      isRetrying = !isRetrying
    }
  } finally {
    isPolling = false
  }
}

async function openPane($: EngineInterface): Promise<string> {
  const opened = await $.ui.open({ id: PANE, title: 'cairn' })
  if (opened.isPlaced) return 'cairn: the pane is open.'
  const said = `cairn: the pane is not shown: ${opened.reason}`
  $.ui.toast(said)
  return said
}

/** Called by register.tsx's single session.start: commands, the first read, the pane, the poll. */
export async function onSessionStart($: EngineInterface, _e: SessionStartInput): Promise<void> {
  for (const spec of COMMANDS) await $.command.register(spec).catch(() => undefined)
  common = await commonDir($).catch(() => undefined)
  // Outside a git repo there are no plans: the commands are all (FR-08).
  if (common === undefined) return
  isRetrying = !(await refresh($))
  const v = await read($, view)
  seen = await signature($, watched(v?.plans ?? []))
  ticking?.cancel()
  ticking = $.clock.every(EVERY_MS, () => void poll($).catch(() => undefined))
  if (v?.here !== undefined && (!v.isFallback || v.plans.filter(isActive).length === 1)) await openPane($)
}

const confirmQuestion = (kind: Kind, slug: string) => `Approve the ${kind} stop of plan ${slug}?`

/** Confirms with fixed wording, then approves through the shared secret path (FR-05). */
async function confirmAndApprove($: EngineInterface, slug: string, kind: Kind): Promise<string> {
  // The slug is the only plan text in the question, and only when it is a plain slug: no tag can ride in.
  if (!SLUG.test(slug)) return 'cairn: the plan name is not a plain slug, so nothing was approved.'
  // $.ui.ask answers only a label, so a dialog that answered itself while the user was away can't be told
  // apart here. Cancel comes first, so a dialog that takes its first option approves nothing.
  const answer = await $.ui.ask(confirmQuestion(kind, slug), ['Cancel', APPROVE]).catch(() => undefined)
  if (answer !== APPROVE) return 'cairn: not approved; nothing was recorded.'
  return approveAs($, slug, kind)
}

/** /cairn-approve [kind]: the stop waiting on the session's plan, resolved by `cairn status --json`. */
async function approveCommand($: EngineInterface, arg: string): Promise<string> {
  if (arg !== '' && !KINDS.includes(arg)) return `cairn: "${arg}" is not a stop; use prd, plan, phase or ship.`
  const found = await plan($)
  if (typeof found === 'string') return 'cairn: this session is not in a plan, so nothing was approved.'
  const state = found.state as CairnPlanState
  const waiting = waitingStop(state as StopState)
  if (waiting === undefined) return `cairn: nothing is waiting for approval on ${state.slug}.`
  if (arg !== '' && arg !== waiting) return `cairn: ${state.slug} is waiting for ${waiting} approval, not ${arg}; nothing was approved.`
  return confirmAndApprove($, state.slug, waiting)
}

/** A press's work; a failure is a toast, never a throw (NFR-07). */
function act($: EngineInterface, work: () => Promise<unknown>): void {
  void work().catch(err => $.ui.toast(`cairn: ${message(err)}`))
}

const PHASE_ICON: Record<string, string> = { done: '✓', awaiting_approval: '◆', in_progress: '◐' }

function phaseLine(p: Phase): string {
  return `${PHASE_ICON[p.status ?? ''] ?? '○'} ${p.name ?? '?'}${p.status === 'awaiting_approval' ? ' (built, waiting for approval)' : ''}`
}

/** A task under its phase: a running one with its substep and fix round, a waiting one with what it waits on. */
function taskLine(x: Task, byId: Map<string, Task>): string {
  const icon = x.status === 'done' ? '✓' : x.status === 'in_progress' ? '◐' : '○'
  let tail = ''
  if (x.status === 'in_progress') tail = ` (${x.substep ?? 'implementing'}${x.fixRound ? `, fix attempt ${x.fixRound}` : ''})`
  else if (x.status === 'pending') {
    const on = (Array.isArray(x.blockedBy) ? x.blockedBy : [])
      .filter((b): b is string => typeof b === 'string' && byId.get(b)?.status !== 'done')
      .map(b => byId.get(b)?.name ?? b)
    if (on.length) tail = ` (waits on ${on.join(', ')})`
  }
  return `  ${icon} ${x.name ?? x.id ?? '?'}${tail}`
}

export function install(on: On): void {
  // The engine heads a command's output with the plugin's name, so its text drops the toast's "cairn: ".
  const asOutput = (said: string) => ({ text: said.replace(/^cairn: /, '') })
  on('command.run', { command: 'cairn-pane' }, async $ => asOutput(await openPane($).catch(message)))
  on('command.run', { command: 'cairn-approve' }, async ($, e) => asOutput(await approveCommand($, (e.args ?? '').trim()).catch(message)))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const v = await read($, view)
    const isRunning = await read($, isTurnRunning)
    const here = v?.plans.find(r => r.state.slug === v.here)
    const others = (v?.plans ?? []).filter(r => r !== here && isActive(r))
    const status = <Button key="status" label="Status" onPress={() => act($, () => $.command.run({ command: 'cairn:status' }))} />

    /** The session's plan: header, tree, drift, the stop, the verdict, and its buttons (FR-09, FR-12). */
    const planLines = (s: CairnPlanState) => {
      const phases = phasesOf(s)
      const tasks = tasksOf(s)
      const byId = new Map(tasks.filter(x => typeof x.id === 'string').map(x => [x.id as string, x]))
      const at = phases.findIndex(p => p.status !== 'done')
      const where = phases.length === 0 ? '' : at < 0 ? ' · all phases done' : ` · phase ${at + 1} of ${phases.length}`
      const drift = openDrift(s)
      const waiting = waitingStop(s as StopState)
      const verdict = [...phases].reverse().find(p => p.verdict?.result !== undefined)
      const isPaused = !!s.paused
      const isTaskRunning = tasks.some(x => x.status === 'in_progress')
      return [
        <Text bold>{s.title ?? s.slug}</Text>,
        v?.isFallback && <Text dimColor>{`Showing ${s.slug}, ${v.plans.filter(isActive).length > 1 ? 'the most recently updated of the active plans' : 'the active plan'}`}</Text>,
        <Text>{`${stageOf(s)}${where}`}</Text>,
        isPaused && <Text color="yellow">{`Paused since ${(s.paused?.at ?? '?').slice(0, 10)}`}</Text>,
        ...phases.flatMap(p => [<Text>{phaseLine(p)}</Text>, ...list<Task>(p.tasks).map(x => <Text>{taskLine(x, byId)}</Text>)]),
        drift.length > 0 && <Text color="yellow">{`${drift.length} unreviewed drift:`}</Text>,
        ...drift.slice(0, DRIFT_SHOWN).map(d => <Text dimColor>{`  ${d.path ?? '?'}`}</Text>),
        <Text bold>{`Waiting on you: ${waiting === undefined ? 'nothing' : `${waiting} approval`}`}</Text>,
        <Text>{verdict === undefined ? 'Last on-track check: none yet' : `Last on-track check: ${verdict.name ?? '?'}: ${verdict.verdict?.result}`}</Text>,
        <Box flexDirection="row" gap={1}>
          {waiting !== undefined && (
            <Button key="approve" label="Approve" variant="primary" onPress={() => act($, () => approvePress($, s.slug, waiting))} />
          )}
          {!isPaused && s.stage !== 'closed' && <Button key="pause" label="Pause" onPress={() => act($, () => pause($, 'drain'))} />}
          {(isTaskRunning || isRunning) && <Button key="stop" label="Stop now" onPress={() => act($, () => stopNow($))} />}
          {isPaused && <Button key="resume" label="Resume" onPress={() => act($, () => resume($))} />}
          {status}
        </Box>,
      ]
    }

    return (
      <Box flexDirection="column">
        {here !== undefined
          ? planLines(here.state)
          : [
              <Text dimColor>{v === null ? 'No cairn plans read yet.' : 'This session is not in a plan worktree.'}</Text>,
              <Box flexDirection="row" gap={1}>{status}</Box>,
            ]}
        {others.length > 0 && <Text bold>Other active plans</Text>}
        {others.map(r => (
          <Box key={`plan:${r.state.slug}`} flexDirection="row" gap={1}>
            <Text>{`${r.state.title ?? r.state.slug} · ${stageOf(r.state)} · ${r.next?.text ?? ''}`}</Text>
            <Button key={`resume:${r.state.slug}`} label="Resume" onPress={() => act($, () => resumeOther($, r.state.slug))} />
          </Box>
        ))}
      </Box>
    )
  })
}

async function approvePress($: EngineInterface, slug: string, kind: Kind): Promise<void> {
  $.ui.toast(await confirmAndApprove($, slug, kind))
}

/** FR-17: `cairn resume <slug>` shows where that plan lives; the list is read again either way. */
async function resumeOther($: EngineInterface, slug: string): Promise<void> {
  await resume($, slug)
  await refresh($)
}
