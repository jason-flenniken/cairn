// The live pane and status line (FR-08..FR-12, FR-05, FR-17). Every 2 s the mod stats the plans'
// state files and re-reads `cairn status --all --json` only when one changed (NFR-01).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, ProcessRunInit, SessionStartInput, Timer } from 'claude-code'
import type { CairnPlanRow, CairnPlanState, CairnView } from '../../types/index.d.ts'
import { etaMs, fmtDuration, LINGER_MS, readAgents, readFeed, readMain, readTick, type EtaTask } from './activity.ts'
import { approveAs, type Kind } from './approve.ts'
import { cairn } from './cli.ts'
import { commonDir } from './heartbeat.ts'
import { pause, pickCurrent, plan, resume, stopNow, turnRunning } from './pause.ts'

type Task = EtaTask & { name?: string; worktree?: string }
type Phase = { name?: string; status?: string; tasks?: unknown; verdict?: { result?: string } }
type Drift = { path?: string; acked?: unknown }

// What the drawing reads lives in $.state, so a hot reload keeps the view.
const view = atom({ plugin: 'cairn', key: 'view' } as const, null as CairnView | null)
const isTurnRunning = atom({ plugin: 'cairn', key: 'isTurnRunning' } as const, false)
// The file whose full text the approval card shows below it (Read all); null while closed.
const readAllOf = atom({ plugin: 'cairn', key: 'readAllOf' } as const, null as string | null)

const PANE = 'cairn'
const PANE_PREF = 'pane'
const EVERY_MS = 2_000
const DRIFT_SHOWN = 5
const APPROVE = 'Approve'
const KINDS: readonly string[] = ['prd', 'plan', 'ship']
const DOCK_COLUMNS = 48
const INLINE_ROWS = 7
const RECENT_SHOWN = 5
const UP_NEXT_SHOWN = 4
const DEFAULT_PARALLEL = 3
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const quick: ProcessRunInit = { timeoutMs: 60_000 }

const STAGE_LABEL: Record<string, string> = {
  discover: 'Discover', repro: 'Repro', prd: 'PRD', plan: 'Plan', execute: 'Build', verify: 'Check',
  review: 'Review', ship: 'Ship', learn: 'Learn', closed: 'Closed',
}

const COMMANDS = [
  { name: 'cairn-pane', description: 'Show or hide the cairn pane: on, off, or with no word, toggle. The choice sticks across sessions.' },
  {
    name: 'cairn-approve',
    description: 'Approve the stop this cairn plan is waiting on, after a confirm.',
    argumentHint: '[prd|plan|ship]',
  },
] as const

const list = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x.filter(v => v !== null && typeof v === 'object') as T[]) : [])
const phasesOf = (s: CairnPlanState) => list<Phase>(s.phases)
const tasksOf = (s: CairnPlanState) => phasesOf(s).flatMap(p => list<Task>(p.tasks))
const openDrift = (s: CairnPlanState) => list<Drift>(s.drift).filter(d => !d.acked)
const stageOf = (s: CairnPlanState) => STAGE_LABEL[s.stage ?? ''] ?? String(s.stage ?? '?')
const isActive = (r: CairnPlanRow) => r.state.stage !== 'closed'
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

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
  return [
    ...plans.filter(r => r.worktree).map(stateFile),
    ...['sdlc', 'feature', 'fix'].map(prefix => `${common}/refs/heads/${prefix}`),
    `${common}/worktrees`,
  ]
}

async function signature($: EngineInterface, paths: string[]): Promise<string> {
  const stamps = await Promise.all(paths.map(p => $.fs.stat(p).then(s => `${p}@${s.mtimeMs}`, () => `${p}@-`)))
  return stamps.join('\n')
}

/** "~40m left" in Build while tasks remain; otherwise nothing. */
function etaText(row: CairnPlanRow, nowMs: number): string | undefined {
  const tasks = tasksOf(row.state)
  if (row.state.stage !== 'execute' || tasks.every(x => x.status === 'done')) return undefined
  const ms = etaMs(tasks, nowMs, row.maxParallel ?? DEFAULT_PARALLEL)
  return `~${fmtDuration(Math.ceil(ms / 60_000) * 60_000, true)} left`
}

/** `cairn · Build 9/19 tasks · 3 working · ~40m left`; away from a plan, how many are active. */
async function statusLine($: EngineInterface, v: CairnView): Promise<string | undefined> {
  const row = v.isFallback ? undefined : v.plans.find(r => r.state.slug === v.here)
  const active = v.plans.filter(isActive).length
  if (row === undefined) return active > 0 ? `${active} active plan${active === 1 ? '' : 's'}` : undefined
  const tasks = tasksOf(row.state)
  const working = (await readAgents($)).filter(c => c.status === 'working').length
  const parts = [
    tasks.length > 0 ? `${stageOf(row.state)} ${tasks.filter(x => x.status === 'done').length}/${tasks.length} tasks` : stageOf(row.state),
    working > 0 && `${working} working`,
    row.state.paused ? 'paused' : etaText(row, await $.clock.now()),
  ]
  return ['cairn', ...parts.filter(Boolean)].join(' · ')
}

// The last status line set, so a poll only calls $.ui.status when the text changed; null before the first.
let shownStatus: string | undefined | null = null

async function showStatus($: EngineInterface, v: CairnView): Promise<void> {
  const text = await statusLine($, v)
  if (text === shownStatus) return
  shownStatus = text
  $.ui.status(text)
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
  await showStatus($, next)
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
    const current = await read($, view)
    // Working agents and the clock change the status line without any file changing.
    if (current !== null) await showStatus($, current)
    const before = watched(current?.plans ?? [])
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
  const opened = await $.ui.open({ id: PANE, title: 'cairn', columns: DOCK_COLUMNS, rows: INLINE_ROWS })
  if (opened.isPlaced) return 'cairn: the pane is open.'
  const said = `cairn: the pane is not shown: ${opened.reason}`
  $.ui.toast(said)
  return said
}

/** Called by register.tsx's single session.start: commands, the first read, the pane, the poll. */
export async function onSessionStart($: EngineInterface, _e: SessionStartInput): Promise<void> {
  for (const spec of COMMANDS) await $.command.register(spec).catch(() => undefined)
  common = await commonDir($).catch(() => undefined)
  // Outside a git repo there are no plans, but the agent cards still apply: the pane opens anyway.
  if (common === undefined) {
    if (!(await isOff($))) await openPane($)
    return
  }
  isRetrying = !(await refresh($))
  const v = await read($, view)
  seen = await signature($, watched(v?.plans ?? []))
  ticking?.cancel()
  ticking = $.clock.every(EVERY_MS, () => void poll($).catch(() => undefined))
  // Open unless the user turned it off: the engine seats an unasked pane once the terminal is wide enough (144 columns, 110 after the user has opened it once).
  if (!(await isOff($))) await openPane($)
}

/** The user's on/off choice, kept across sessions; a store that fails reads as on. */
async function isOff($: EngineInterface): Promise<boolean> {
  return (await $.store.get(PANE_PREF).catch(() => undefined)) === 'off'
}

/** /cairn-pane [on|off]: with no word, hides the pane when shown and shows it when hidden. */
async function togglePane($: EngineInterface, arg: string): Promise<string> {
  if (!['', 'on', 'off'].includes(arg)) return 'cairn: use /cairn-pane, /cairn-pane on, or /cairn-pane off.'
  const isShown = (await $.ui.panes().catch(() => [])).some(p => p.id === PANE && p.isShown)
  if (arg === 'off' || (arg === '' && isShown)) {
    await $.store.set(PANE_PREF, 'off').catch(() => undefined)
    await $.ui.close({ id: PANE }).catch(() => undefined)
    return 'cairn: the pane is off, in this and later sessions. /cairn-pane brings it back.'
  }
  await $.store.set(PANE_PREF, 'on').catch(() => undefined)
  return openPane($)
}

const confirmQuestion = (kind: Kind, slug: string) => `Approve the ${kind} stop of plan ${slug}?`

/** Confirms with fixed wording, then approves through the shared secret path (FR-05). */
async function confirmAndApprove($: EngineInterface, slug: string, kind: Kind): Promise<string | undefined> {
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
  if (arg !== '' && !KINDS.includes(arg)) return `cairn: "${arg}" is not a stop; use prd, plan or ship.`
  const found = await plan($)
  if (typeof found === 'string') return 'cairn: this session is not in a plan, so nothing was approved.'
  const state = found.state as CairnPlanState
  const waiting = found.ready?.kind
  if (waiting === undefined) return `cairn: nothing is ready for approval on ${state.slug}.`
  if (arg !== '' && arg !== waiting) return `cairn: ${state.slug} is waiting for ${waiting} approval, not ${arg}; nothing was approved.`
  return (await confirmAndApprove($, state.slug, waiting)) ?? `cairn: ${state.slug} ${waiting} is already approved.`
}

/** A press's work; a failure is a toast, never a throw (NFR-07). */
function act($: EngineInterface, work: () => Promise<unknown>): void {
  void work().catch(err => $.ui.toast(`cairn: ${message(err)}`))
}

const steps = (n: number) => `${n} step${n === 1 ? '' : 's'}`

const hourMinute = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const isReady = (x: Task, byId: Map<string, Task>) =>
  x.status === 'pending' && (Array.isArray(x.blockedBy) ? x.blockedBy : []).every(b => byId.get(b as string)?.status === 'done')

const spanOf = (x: Task) => Date.parse(x.doneAt ?? '') - Date.parse(x.startedAt ?? '')

/** A plan log entry in plain words; undefined for the ones not worth a line. */
function logText(entry: { event?: string; detail?: string }): string | undefined {
  const { event = '', detail } = entry
  if (['created', 'task started', 'drift', 'drift reviewed'].includes(event)) return undefined
  if (event === 'task done') return `Task done: ${detail ?? ''}`.trim()
  if (event === 'advanced') return `Moved on to ${detail ?? 'the next stage'}`
  return `${event.charAt(0).toUpperCase()}${event.slice(1)}${detail ? `: ${detail}` : ''}`
}

/** The last few events, oldest first: the plan's log and the agents that finished. */
function recentLines(s: CairnPlanState, feed: { at: number; text: string }[]): string[] {
  const fromLog = list<{ at?: string; event?: string; detail?: string }>(s.log).flatMap(entry => {
    const text = logText(entry)
    const at = Date.parse(entry.at ?? '')
    return text === undefined || Number.isNaN(at) ? [] : [{ at, text }]
  })
  return [...fromLog, ...feed].sort((a, b) => a.at - b.at).slice(-RECENT_SHOWN).map(l => `${hourMinute(l.at)} ${l.text}`)
}

export function install(on: On): void {
  // The engine heads a command's output with the plugin's name, so its text drops the toast's "cairn: ".
  const asOutput = (said: string) => ({ text: said.replace(/^cairn: /, '') })
  on('command.run', { command: 'cairn-pane' }, async ($, e) => asOutput(await togglePane($, (e.args ?? '').trim().toLowerCase()).catch(message)))
  // Closing it by hand turns it off too, so it doesn't come back next session.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await $.store.set(PANE_PREF, 'off').catch(() => undefined)
    return next(e)
  })
  on('command.run', { command: 'cairn-approve' }, async ($, e) => asOutput(await approveCommand($, (e.args ?? '').trim()).catch(message)))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const v = await read($, view)
    const isRunning = await read($, isTurnRunning)
    await readTick($)
    const t = await $.clock.now()
    const isInline = e.props.placement === 'inline'
    const here = v?.plans.find(r => r.state.slug === v.here)
    const others = (v?.plans ?? []).filter(r => r !== here && isActive(r))
    const status = <Button key="status" label="Status" onPress={() => act($, () => $.command.run({ command: 'cairn:status' }))} />
    const cards = (await readAgents($)).filter(c => c.status === 'working' || t - (c.endedAt ?? 0) < LINGER_MS[c.status])
    const main = await readMain($)
    const feed = await readFeed($)
    // Read all: the document's own text, read when the card is open.
    const openFile = await read($, readAllOf)
    const docText = openFile === null ? '' : await $.fs.read(openFile).catch((err: unknown) => `Could not read ${openFile}: ${message(err)}`)

    /** A line with something at each end, the left one cut short before the right one is. */
    const split = (key: string, left: string, right: string, color?: 'green' | 'yellow') => (
      <Box key={key} flexDirection="row" justifyContent="space-between">
        <Box flexGrow={1} flexShrink={1}><Text color={color} wrap="truncate-end">{left}</Text></Box>
        <Text dimColor>{right}</Text>
      </Box>
    )

    /** One agent as a bordered card; the main session is the same card with its own words. */
    const card = (key: string, border: 'cyan' | 'green' | 'red' | 'gray', title: string, model: string, lines: string[], dim: string[], agentId?: string) => (
      <Box key={`${key}:card`} flexDirection="column" borderStyle="round" borderColor={border} paddingX={1}>
        <Box key={`${key}:title`} flexDirection="row" justifyContent="space-between">
          <Box flexGrow={1} flexShrink={1}>
            <Button key={key} plain onPress={() => act($, () => viewPress($, agentId))}><Text wrap="truncate-end">{title}</Text></Button>
          </Box>
          <Text dimColor>{model}</Text>
        </Box>
        {lines.map((l, i) => <Text key={`${key}:l${i}`} wrap="truncate-end">{l}</Text>)}
        {dim.map((l, i) => <Text key={`${key}:d${i}`} dimColor wrap="truncate-end">{l}</Text>)}
      </Box>
    )

    const agentCard = (c: (typeof cards)[number]) => {
      if (c.status === 'working') {
        return card(`agent:${c.agentId}`, 'cyan', c.title, c.model, [`● working · ${fmtDuration(t - c.startedAt)}`], [...(c.action ? [c.action] : []), steps(c.steps)], c.agentId)
      }
      const size = c.tokens === undefined ? '' : ` · ${c.tokens >= 1000 ? `${Math.round(c.tokens / 1000)}k` : c.tokens} tokens`
      const took = fmtDuration(c.durationMs ?? 0)
      return card(`agent:${c.agentId}`, c.status === 'done' ? 'green' : 'red', c.title, c.model, [`${c.status === 'done' ? '✓ finished' : '✗ stopped'} · ${took}${size}`], [steps(c.steps)], c.agentId)
    }

    const mainCard = () =>
      main === null
        ? card('main', 'gray', 'Main session', '', ['waiting for you'], [])
        : card('main', 'cyan', 'Main session', '', [`● ${main.action} · ${fmtDuration(t - main.since)}`], [])

    /** One line per agent for the inline fit, where a card would not. */
    const agentLines = () => [
      ...cards.filter(c => c.status === 'working').map(c => <Text key={c.agentId} wrap="truncate-end">{`● ${c.title} · ${c.action ?? 'working'} · ${fmtDuration(t - c.startedAt)}`}</Text>),
      <Text key="main" wrap="truncate-end">{main === null ? '● Main session · waiting for you' : `● Main session · ${main.action} · ${fmtDuration(t - main.since)}`}</Text>,
    ]

    /** The session's plan: header, progress, the stop, the cards, the phases, and its buttons (FR-09, FR-12). */
    const planLines = (row: CairnPlanRow) => {
      const s = row.state
      const phases = phasesOf(s)
      const tasks = tasksOf(s)
      const byId = new Map(tasks.filter(x => typeof x.id === 'string').map(x => [x.id as string, x]))
      const at = phases.findIndex(p => p.status !== 'done')
      const where = phases.length === 0 ? '' : at < 0 ? ' · all phases done' : ` · phase ${at + 1} of ${phases.length}`
      const done = tasks.filter(x => x.status === 'done').length
      const drift = openDrift(s)
      const ready = row.ready
      const waiting = ready?.kind
      const isPaused = !!s.paused
      const isTaskRunning = tasks.some(x => x.status === 'in_progress')
      const eta = etaText(row, t)
      const rest = waiting !== undefined ? 'Waiting on you' : row.next?.text
      const label = [tasks.length > 0 && `${done}/${tasks.length} tasks`, s.stage === 'execute' ? eta : rest, (row.openSuggestions ?? 0) > 0 && `${row.openSuggestions} suggestions`]
        .filter(Boolean).join(' · ')
      const bar = Math.min(20, Math.max(6, e.props.bodyColumns - label.length - 1))
      const filled = tasks.length === 0 ? 0 : Math.round((done / tasks.length) * bar)
      const upNext = tasks
        .filter(x => x.status === 'pending' && phases[at]?.tasks !== undefined && list<Task>(phases[at]?.tasks).includes(x))
        .slice(0, UP_NEXT_SHOWN)
        .map(x => `${x.name ?? x.id}${isReady(x, byId) ? '' : ' (waits)'}`)
      const recent = recentLines(s, feed)
      const buttons = (
        <Box key="buttons" flexDirection="row" gap={1}>
          {!isPaused && s.stage !== 'closed' && <Button key="pause" label="Pause" onPress={() => act($, () => pause($, 'drain'))} />}
          {(isTaskRunning || isRunning) && <Button key="stop" label="Stop now" onPress={() => act($, () => stopNow($))} />}
          {isPaused && <Button key="resume" label="Resume" onPress={() => act($, () => resume($))} />}
          {status}
        </Box>
      )
      const header = [
        <Text key="head" bold wrap="truncate-end">{`${s.title ?? s.slug} · ${stageOf(s)}${where}`}</Text>,
        v?.isFallback && <Text key="fallback" dimColor>{`Showing ${s.slug}, ${v.plans.filter(isActive).length > 1 ? 'the most recently updated of the active plans' : 'the active plan'}`}</Text>,
        isPaused && <Text key="paused" color="yellow">{`Paused since ${(s.paused?.at ?? '?').slice(0, 10)}`}</Text>,
        tasks.length > 0 ? <Text key="bar" wrap="truncate-end">{`${'█'.repeat(filled)}${'░'.repeat(bar - filled)} ${label}`}</Text> : <Text key="bar" dimColor wrap="truncate-end">{label}</Text>,
      ]
      // The approval card shows only while the CLI says the document is ready, never while it is being drafted (FR-11).
      const isOpen = ready !== undefined && openFile === ready.file
      const approve = ready !== undefined && (
        <Box key="waiting" flexDirection={isInline ? 'row' : 'column'} gap={1} borderStyle={isInline ? undefined : 'round'} borderColor="yellow" paddingX={isInline ? 0 : 1}>
          {isInline
            ? <Text bold color="yellow">{`Waiting on you: ${ready.kind} approval`}</Text>
            : <Button key="approval" plain onPress={() => act($, () => viewPress($))}><Text bold color="yellow">{`Waiting on you: ${ready.kind} approval`}</Text></Button>}
          {!isInline && <Markdown key="summary" text={ready.summary} />}
          <Box key="approval:buttons" flexDirection="row" gap={1}>
            {!isInline && (
              <Button key="readall" label={isOpen ? 'Close' : 'Read all'} onPress={() => act($, () => update($, readAllOf, cur => (cur === ready.file ? null : ready.file)))} />
            )}
            <Button key="approve" label="Approve" variant="primary" onPress={() => act($, () => approvePress($, s.slug, ready.kind))} />
          </Box>
          {isOpen && <Markdown key="document" text={docText} />}
        </Box>
      )

      if (isInline) {
        return [...header, approve, ...agentLines(), <Text key="tip" dimColor>Full-height side pane: run /tui fullscreen</Text>, buttons]
      }

      return [
        ...header,
        approve,
        <Text key="now" bold>NOW</Text>,
        ...cards.map(agentCard),
        mainCard(),
        upNext.length > 0 && <Text key="next" wrap="truncate-end">{`UP NEXT  ${upNext.join(' · ')}`}</Text>,
        ...phases.flatMap((p, i) => {
          const mine = list<Task>(p.tasks)
          const name = `${i + 1} ${p.name ?? '?'}`
          if (p.status === 'done') {
            const spans = mine.map(spanOf).filter(n => n >= 0)
            const starts = mine.map(x => Date.parse(x.startedAt ?? '')).filter(n => !Number.isNaN(n))
            const ends = mine.map(x => Date.parse(x.doneAt ?? '')).filter(n => !Number.isNaN(n))
            const took = spans.length > 0 && starts.length > 0 && ends.length > 0 ? ` · ${fmtDuration(Math.max(...ends) - Math.min(...starts), true)}` : ''
            return [split(`phase:${i}`, `✓ ${name}`, `${mine.length} tasks${took}`, 'green')]
          }
          const finished = mine.filter(x => x.status === 'done').length
          if (i !== at) return [split(`phase:${i}`, `○ ${name}`, `0 of ${mine.length}`)]
          return [
            split(`phase:${i}`, `◐ ${name}`, `${finished} of ${mine.length}`),
            ...mine.filter(x => x.status !== 'pending').map(x =>
              split(`task:${x.id ?? x.name}`, `   ${x.status === 'done' ? '✓' : '●'} ${x.name ?? x.id ?? '?'}`, x.status === 'done' && spanOf(x) >= 0 ? fmtDuration(spanOf(x), true) : '', x.status === 'done' ? 'green' : undefined)),
          ]
        }),
        drift.length > 0 && <Text key="drift" color="yellow">{`${drift.length} out-of-scope edit${drift.length === 1 ? "" : "s"}:`}</Text>,
        ...drift.slice(0, DRIFT_SHOWN).map((d, i) => <Text key={`drift:${i}`} dimColor wrap="truncate-end">{`  ${d.path ?? '?'}`}</Text>),
        ...recent.map((l, i) => <Text key={`recent:${i}`} dimColor wrap="truncate-end">{l}</Text>),
        buttons,
      ]
    }

    return (
      <Box flexDirection="column">
        {here !== undefined && isActive(here)
          ? planLines(here)
          : [
              <Text key="head" bold>cairn</Text>,
              <Text key="none" dimColor wrap="truncate-end">{others.length > 0 ? 'This session is not in a plan.' : 'No plan in progress. Start one with /cairn:new.'}</Text>,
              (v?.plans[0]?.openSuggestions ?? 0) > 0 && <Text key="sugg" dimColor>{`${v?.plans[0]?.openSuggestions} open suggestions · /cairn:suggestions`}</Text>,
              ...(isInline ? agentLines() : [<Text key="now" bold>NOW</Text>, ...cards.map(agentCard), mainCard()]),
              <Box key="buttons" flexDirection="row" gap={1}>{status}</Box>,
            ]}
        {others.length > 0 && <Text bold>Other active plans</Text>}
        {others.map(r => (
          <Box key={`plan:${r.state.slug}`} flexDirection="row" gap={1}>
            <Text wrap="truncate-end">{`${r.state.title ?? r.state.slug} · ${stageOf(r.state)} · ${r.next?.text ?? ''}`}</Text>
            <Button key={`resume:${r.state.slug}`} label="Resume" onPress={() => act($, () => resumeOther($, r.state.slug))} />
          </Box>
        ))}
      </Box>
    )
  })
}

async function approvePress($: EngineInterface, slug: string, kind: Kind): Promise<void> {
  const said = await confirmAndApprove($, slug, kind)
  if (said !== undefined) $.ui.toast(said)
}

/** Puts an agent's conversation in the main view, or the main one for no id; a refusal is a toast. */
async function viewPress($: EngineInterface, agentId?: string): Promise<void> {
  const shown = await $.ui.view(agentId === undefined ? {} : { agentId })
  if (shown.deny !== undefined) $.ui.toast(`cairn: ${shown.deny}`)
}

/** FR-17: `cairn resume <slug>` shows where that plan lives; the list is read again either way. */
async function resumeOther($: EngineInterface, slug: string): Promise<void> {
  await resume($, slug)
  await refresh($)
}
