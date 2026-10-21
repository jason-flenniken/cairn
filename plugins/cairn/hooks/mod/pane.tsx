// The live pane and status line (FR-08..FR-12, FR-05, FR-17). Every 2 s the mod stats the plans'
// state files and re-reads `cairn status --all --json` only when one changed (NFR-01).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, ProcessRunInit, RenderChildren, SessionStartInput, Timer } from 'claude-code'
import type { CairnPlanRow, CairnPlanState, CairnRecord, CairnView } from '../../types/index.d.ts'
import { LINGER_MS, readAgents, readFeed, readMain, readTick } from './activity.ts'
import { approvalCard, approvePress, confirmAndApprove } from './approval.tsx'
import { activeStep, Bar, cells, stageSteps, type BarLine } from './bar.tsx'
import { act, agentCard, agentLines, mainCard, message, type CardContext } from './cards.tsx'
import { cairn } from './cli.ts'
import { docViewer, openDoc, readDoc, scrollToStart } from './doc.tsx'
import { isActive, list, phaseAt, phasesOf, planHeader, STAGE_COLOR, stageOf, statusLine, tasksOf, type Task } from './header.tsx'
import { commonDir } from './heartbeat.ts'
import { pause, pickCurrent, plan, resume, stopNow, turnRunning } from './pause.ts'
import { inlineUsage, install as installUsage, limitsLine, modelLine, readBaseline, readUsage, syncBaseline } from './usage.ts'

type Drift = { path?: string; acked?: unknown }

// What the drawing reads lives in $.state, so a hot reload keeps the view.
const view = atom({ plugin: 'cairn', key: 'view' } as const, null as CairnView | null)
const isTurnRunning = atom({ plugin: 'cairn', key: 'isTurnRunning' } as const, false)
// The tab showing; the pane opens on Now.
const tab = atom({ plugin: 'cairn', key: 'tab' } as const, 'now' as 'now' | 'history' | 'records')
// Records tab: the last `cairn records --json` (null until read) and the plan whose record is open.
const records = atom({ plugin: 'cairn', key: 'records' } as const, null as CairnRecord[] | null)
const openRecord = atom({ plugin: 'cairn', key: 'openRecord' } as const, null as string | null)
const TABS = [['now', 'Now'], ['history', 'History'], ['records', 'Records']] as const

const PANE = 'cairn'
const PANE_PREF = 'pane'
const EVERY_MS = 2_000
const DRIFT_SHOWN = 5
const KINDS: readonly string[] = ['prd', 'plan', 'ship']
const DOCK_COLUMNS = 48
const INLINE_ROWS = 7
const UP_NEXT_SHOWN = 4
const quick: ProcessRunInit = { timeoutMs: 60_000 }

const COMMANDS = [
  { name: 'cairn-pane', description: 'Show or hide the cairn pane: on, off, or with no word, toggle. The choice sticks across sessions.' },
  {
    name: 'cairn-approve',
    description: 'Approve the stop this cairn plan is waiting on, after a confirm.',
    argumentHint: '[prd|plan|ship]',
  },
] as const

const openDrift = (s: CairnPlanState) => list<Drift>(s.drift).filter(d => !d.acked)

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

const stateFile = (r: CairnPlanRow) => `${r.dir ?? `${r.worktree}/docs/sdlc/plans/${r.state.slug}`}/state.json`

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

/** Reads `cairn records --json` into the Records tab; a failed read keeps what was there. */
async function fetchRecords($: EngineInterface): Promise<void> {
  const r = await cairn($, ['records', '--json'], quick).catch(() => undefined)
  const body = r?.json as { records?: unknown } | undefined
  if (r?.exitCode !== 0 || !Array.isArray(body?.records)) return
  const found = list<CairnRecord>(body.records).filter(x => typeof x.slug === 'string')
  await update($, records, () => found)
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
  await trackCost($, next)
  if ((await read($, tab)) === 'records') await fetchRecords($)
  return true
}

/** Starts the plan cost over when the shown plan is first seen active, changes, or is resumed. */
async function trackCost($: EngineInterface, v: CairnView): Promise<void> {
  const row = v.plans.find(r => r.state.slug === v.here)
  await syncBaseline($, row !== undefined && isActive(row) ? row.state.slug : undefined, !!row?.state.paused)
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
    if (current !== null) {
      await showStatus($, current)
      await trackCost($, current)
    }
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Oct 21" for a record's YYYY-MM-DD date; the text itself when it is not one. */
const dateText = (date: string) => {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date)
  const month = m === null ? undefined : MONTHS[Number(m[1]) - 1]
  return m === null || month === undefined ? date : `${month} ${Number(m[2])}`
}

/** "14:05" for an event today, "Oct 20 14:05" for one from any earlier day. */
const stampOf = (ms: number, nowMs: number) => {
  const d = new Date(ms)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return d.toDateString() === new Date(nowMs).toDateString() ? hm : `${MONTHS[d.getMonth()]} ${d.getDate()} ${hm}`
}

const isReady = (x: Task, byId: Map<string, Task>) =>
  x.status === 'pending' && (Array.isArray(x.blockedBy) ? x.blockedBy : []).every(b => byId.get(b as string)?.status === 'done')

/** A plan log entry in plain words; undefined for the ones not worth a line. */
function logText(entry: { event?: string; detail?: string }): string | undefined {
  const { event = '', detail } = entry
  if (['created', 'task started', 'drift', 'drift reviewed'].includes(event)) return undefined
  if (event === 'task done') return `Task done: ${detail ?? ''}`.trim()
  if (event === 'advanced') return `Moved on to ${detail ?? 'the next stage'}`
  return `${event.charAt(0).toUpperCase()}${event.slice(1)}${detail ? `: ${detail}` : ''}`
}

/** Every event of the plan's log and the agents that finished, oldest first. */
function recentLines(s: CairnPlanState, feed: { at: number; text: string }[], nowMs: number): string[] {
  const fromLog = list<{ at?: string; event?: string; detail?: string }>(s.log).flatMap(entry => {
    const text = logText(entry)
    const at = Date.parse(entry.at ?? '')
    return text === undefined || Number.isNaN(at) ? [] : [{ at, text }]
  })
  return [...fromLog, ...feed].sort((a, b) => a.at - b.at).map(l => `${stampOf(l.at, nowMs)} ${l.text}`)
}

export function install(on: On): void {
  installUsage(on)
  // The engine heads a command's output with the plugin's name, so its text drops the toast's "cairn: ".
  const asOutput = (said: string) => ({ text: said.replace(/^cairn: /, '') })
  on('command.run', { command: 'cairn-pane' }, async ($, e) => asOutput(await togglePane($, (e.args ?? '').trim().toLowerCase()).catch(message)))
  // Closing it by hand turns it off too, so it doesn't come back next session.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await $.store.set(PANE_PREF, 'off').catch(() => undefined)
    return next(e)
  })
  on('command.run', { command: 'cairn-approve' }, async ($, e) => asOutput(await approveCommand($, (e.args ?? '').trim()).catch(message)))
  // The bar sits at the window's last rows, so every move of the window draws it again there.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    $.ui.invalidate('ui.render')
    return moved
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = ui
    const v = await read($, view)
    const isRunning = await read($, isTurnRunning)
    const shownTab = await read($, tab)
    const openedRecord = await read($, openRecord)
    await readTick($)
    const t = await $.clock.now()
    const isInline = e.props.placement === 'inline'
    const here = v?.plans.find(r => r.state.slug === v.here)
    const accent = STAGE_COLOR[here?.state.stage ?? ''] ?? 'cyan'
    const others = (v?.plans ?? []).filter(r => r !== here && isActive(r))
    // Every tab's root: 1 column in from each edge; docked, a blank line between its children (an absent
    // `false` child adds none). Claude Code paints the docked pane's background and the mod has no setting for it.
    const rootProps = { flexDirection: 'column', paddingX: 1, gap: isInline ? 0 : 1 } as const
    const status = <Button key="status" label="Status" onPress={() => act($, () => $.command.run({ command: 'cairn:status' }))} />
    const cards = (await readAgents($)).filter(c => c.status === 'working' || t - (c.endedAt ?? 0) < LINGER_MS[c.status])
    const main = await readMain($)
    const used = await readUsage($)
    const baseline = await readBaseline($)
    const cx: CardContext = { ui, accent, nowMs: t, columns: e.props.bodyColumns - 6 }
    // The bar's lines: docked, every stage step, then the usage lines; inline, the active step with the plan cost and limits.
    const planSlug = here !== undefined && isActive(here) ? here.state.slug : undefined
    const step = here === undefined ? [] : activeStep(here.state, here.prOpen)
    // Inline, the other plans fold into one line, so the budget below counts one row for them.
    const othersRows = isInline && others.length > 0 ? 1 : 0
    const barLines: BarLine[] = isInline
      ? step.length === 0
        ? []
        : [[...step, ...inlineUsage(used, baseline, planSlug, e.props.bodyColumns - 2 - step.reduce((n, seg) => n + cells(seg.text), 0))]]
      : [
          ...(here === undefined ? [] : stageSteps(here.state, here.prOpen, e.props.bodyColumns - 2)),
          modelLine(used, baseline, planSlug, e.props.bodyColumns - 2),
          limitsLine(used, t, e.props.bodyColumns - 2),
        ].filter(line => line.length > 0)

    /**
     * A tab's root with the bar at the bottom (FR-01). Docked, the engine scrolls the body, so the bar is
     * absolute at the window's last rows, `offset + bodyRows - rows` from the top; the content is padded
     * by the bar's rows and a blank line, and fills at least the window so a short tab still has the bar
     * at the bottom. Inline the pane fits its tree, so the bar is just the last line.
     */
    const frame = (ev: typeof e, content: RenderChildren, lines: BarLine[]) => {
      const columns = ev.props.bodyColumns - 2
      if (ev.props.placement === 'inline' || lines.length === 0) {
        return <Box {...rootProps}>{content}{lines.length > 0 && Bar({ ui, lines, columns })}</Box>
      }
      const { offset, bodyRows } = ev.props.scroll
      const rows = lines.length
      return (
        <Box {...rootProps} minHeight={bodyRows} paddingBottom={rows + 1}>
          {content}
          {Bar({ ui, lines, columns, top: offset + bodyRows - rows })}
        </Box>
      )
    }

    /** The session's plan: header, progress, the stop, the cards, and its buttons (FR-09, FR-12). */
    const planLines = async (row: CairnPlanRow) => {
      const s = row.state
      const phases = phasesOf(s)
      const tasks = tasksOf(s)
      const byId = new Map(tasks.filter(x => typeof x.id === 'string').map(x => [x.id as string, x]))
      const at = phaseAt(s)
      const drift = openDrift(s)
      const ready = row.ready
      const isPaused = !!s.paused
      const isTaskRunning = tasks.some(x => x.status === 'in_progress')
      const upNext = tasks
        .filter(x => x.status === 'pending' && phases[at]?.tasks !== undefined && list<Task>(phases[at]?.tasks).includes(x))
        .slice(0, UP_NEXT_SHOWN)
        .map(x => `${x.name ?? x.id}${isReady(x, byId) ? '' : ' (waits)'}`)
      const buttons = (
        <Box key="buttons" flexDirection="row" gap={1}>
          {!isPaused && s.stage !== 'closed' && <Button key="pause" label="Pause" onPress={() => act($, () => pause($, 'drain'))} />}
          {(isTaskRunning || isRunning) && <Button key="stop" label="Stop now" onPress={() => act($, () => stopNow($))} />}
          {isPaused && <Button key="resume" label="Resume" onPress={() => act($, () => resume($))} />}
          {status}
        </Box>
      )
      const header = planHeader(ui, row, accent, e.props.bodyColumns, t, v?.isFallback ? v.plans.filter(isActive).length : undefined, cards.filter(c => c.status === 'working').length)
      const approve = ready !== undefined && (await approvalCard($, ui, s.slug, ready, isInline))

      if (isInline) {
        // One budget over every inline row: title and progress, the fallback and paused notes, the approval, the
        // other-plans line, the buttons and the bar are fixed; the agents take what is left, and the tip only
        // shows while a row is still free after them.
        const fixed = 2 + (v?.isFallback ? 1 : 0) + (isPaused ? 1 : 0) + (approve ? 1 : 0) + othersRows + 1 + barLines.length
        const lines = agentLines(cx, main, cards, INLINE_ROWS - fixed)
        const rows = fixed + lines.length
        const tip = rows < INLINE_ROWS && <Text key="tip" dimColor wrap="truncate-end">Full-height side pane: run /tui fullscreen</Text>
        return [header, approve, ...lines, tip, buttons]
      }

      return [
        header,
        approve,
        mainCard($, cx, main),
        ...cards.map(c => agentCard($, cx, c)),
        upNext.length > 0 && <Text key="next" wrap="truncate-end">{`UP NEXT  ${upNext.join(' · ')}`}</Text>,
        drift.length > 0 && (
          <Box key="drift:box" flexDirection="column">
            <Text key="drift" color="yellow">{`${drift.length} out-of-scope edit${drift.length === 1 ? "" : "s"}:`}</Text>
            {drift.slice(0, DRIFT_SHOWN).map((d, i) => <Text key={`drift:${i}`} dimColor wrap="truncate-end">{`  ${d.path ?? '?'}`}</Text>)}
          </Box>
        ),
        buttons,
      ]
    }

    const tabs = (
      <Box key="tabs" flexDirection="row" gap={1}>
        {TABS.map(([id, name]) => (
          <Button key={`tab:${id}`} label={name} variant={shownTab === id ? 'primary' : undefined} onPress={() => act($, async () => {
            await update($, tab, () => id)
            await scrollToStart($, PANE)
            if (id === 'records') await fetchRecords($)
          })} />
        ))}
      </Box>
    )

    // The viewer takes the tab's place; Approve is in it only while this very document waits on approval.
    const doc = isInline ? null : await readDoc($)
    if (doc !== null) {
      const waiting = here?.ready?.file === doc.file ? here.ready : undefined
      const followUps = doc.kind === 'record' ? (await read($, records))?.find(x => x.record === doc.file)?.followUps.filter(f => f.status === 'open') ?? [] : []
      return frame(e, await docViewer(
        $, PANE, ui, doc,
        waiting === undefined || here === undefined ? undefined : () => act($, () => approvePress($, here.state.slug, waiting.kind)),
        followUps.length > 0 ? `**Follow-ups**\n\n${followUps.map(f => `- ${f.text} (${f.area})`).join('\n')}` : undefined,
      ), barLines)
    }

    if (!isInline && shownTab === 'records') {
      const all = await read($, records)
      const shown = all?.find(x => x.slug === openedRecord)
      if (shown !== undefined) {
        const open = shown.followUps.filter(f => f.status === 'open')
        return frame(e, [
          tabs,
          <Button key="back" label="Back" onPress={() => act($, () => update($, openRecord, () => null))} />,
          <Text key="missing" dimColor>{shown.stage === 'closed' ? 'No record for this plan.' : 'Still in progress: no record yet.'}</Text>,
          open.length > 0 && <Markdown key="followups" text={`**Follow-ups**\n\n${open.map(f => `- ${f.text} (${f.area})`).join('\n')}`} />,
        ], barLines)
      }
      return frame(e, [
        tabs,
        ...(all ?? []).map(x => {
          // A record with a file opens in the doc viewer; one without shows its short note.
          const press = () => act($, () => x.record === undefined
            ? update($, openRecord, () => x.slug)
            : openDoc($, PANE, { file: x.record, title: x.title, kind: 'record' }))
          return (
          <Box key={`record:${x.slug}:row`} flexDirection="column">
            <Button key={`record:${x.slug}`} plain onPress={press}>
              <Text wrap="truncate-end">{`${x.stage === 'closed' ? dateText(x.date) : 'In progress'} · ${x.title}`}</Text>
            </Button>
            <Button key={`record:${x.slug}:why`} plain onPress={press}>
              <Text dimColor wrap="truncate-end">{x.why}</Text>
            </Button>
          </Box>
          )
        }),
        all !== null && !all.some(x => x.stage === 'closed') && <Text dimColor>No finished plans yet.</Text>,
      ], barLines)
    }

    if (!isInline && shownTab === 'history') {
      const lines = here === undefined ? [] : recentLines(here.state, await readFeed($), t).reverse()
      return frame(e, [
        tabs,
        <Box key="timeline" flexDirection="column">
          {lines.length === 0 && <Text dimColor>Nothing logged yet.</Text>}
          {lines.map((line, i) => <Text key={`history:${i}`} color={accent} wrap="truncate-end">{line}</Text>)}
        </Box>,
      ], barLines)
    }

    return frame(e, [
      !isInline && tabs,
      here !== undefined && isActive(here)
        ? await planLines(here)
        : [
            <Box key="idle" flexDirection="column">
              <Text key="head" bold>cairn</Text>
              <Text key="none" dimColor wrap="truncate-end">{others.length > 0 ? 'This session is not in a plan.' : 'No plan in progress. Start one with /cairn:new.'}</Text>
            </Box>,
            ...(isInline ? agentLines(cx, main, cards, INLINE_ROWS - 2 - 1 - othersRows - barLines.length) : [mainCard($, cx, main), ...cards.map(c => agentCard($, cx, c))]),
            <Box key="buttons" flexDirection="row" gap={1}>{status}</Box>,
          ],
      others.length > 0 && isInline && (
        <Text key="others" dimColor wrap="truncate-end">{`+${others.length} other active plan${others.length === 1 ? '' : 's'}`}</Text>
      ),
      others.length > 0 && !isInline && (
        <Box key="others" flexDirection="column">
          <Text bold>Other active plans</Text>
          {others.map(r => (
            <Box key={`plan:${r.state.slug}`} flexDirection="row" gap={1}>
              <Text wrap="truncate-end">{`${r.state.title ?? r.state.slug} · ${stageOf(r.state, r.prOpen)} · ${r.next?.text ?? ''}`}</Text>
              <Button key={`resume:${r.state.slug}`} label="Resume" onPress={() => act($, () => resumeOther($, r.state.slug))} />
            </Box>
          ))}
        </Box>
      ),
    ], barLines)
  })
}

/** FR-17: `cairn resume <slug>` shows where that plan lives; the list is read again either way. */
async function resumeOther($: EngineInterface, slug: string): Promise<void> {
  await resume($, slug)
  await refresh($)
}
