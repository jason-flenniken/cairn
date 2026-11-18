// The plan header the pane draws over Now (FR-09), the status line `$.ui.status` shows (FR-11),
// and the plan-reading helpers the other pane modules share.
import type { Elements, EngineInterface, RenderSurface } from 'claude-code'
import type { CairnPlanRow, CairnPlanState, CairnView } from '../../types/index.d.ts'
import { etaMs, readAgents, type EtaTask } from './activity.ts'
import { clean, fmtDuration } from './util.ts'

/** The element table a render hook resolved, as the pane modules draw with it. */
export type Ui = Elements[RenderSurface]

export type Task = EtaTask & { name?: string; worktree?: string }
export type Phase = { name?: string; status?: string; tasks?: unknown; verdict?: { result?: string } }

const DEFAULT_PARALLEL = 3

export const STAGE_LABEL: Record<string, string> = {
  discover: 'Discover', repro: 'Repro', prd: 'PRD', plan: 'Plan', execute: 'Build', verify: 'Check',
  review: 'Review', ship: 'Ship', learn: 'Learn', closed: 'Closed',
}

/** One color per stage: the header, progress bar and borders of working cards use it. */
export const STAGE_COLOR: Record<string, string> = {
  discover: 'cyan', repro: 'red', prd: 'magenta', plan: 'blue', execute: 'yellowBright', verify: 'greenBright',
  review: 'magentaBright', ship: 'cyanBright', learn: 'blueBright', closed: 'gray',
}

/** The stages after Build: the phases are finished, so the header shows the stage and its step instead. */
const LATE_STAGES = ['verify', 'review', 'ship', 'learn']

/** " · Polished · 12m": the CLI's level label and the current stage's time, each only when the CLI gave one. */
export function levelTail(row: CairnPlanRow): string {
  const ms = row.timing?.[row.state.stage ?? '']
  return `${row.levelLabel ? ` · ${row.levelLabel}` : ''}${typeof ms === 'number' ? ` · ${fmtDuration(ms, true)}` : ''}`
}

/** After Build: " · fixing 3 findings", then " · 2 running" while agents work. */
export function lateTail(row: CairnPlanRow, running: number): string {
  if (!LATE_STAGES.includes(row.state.stage ?? '')) return ''
  const step = row.stepText
  return `${step !== undefined ? ` · ${step}` : ''}${running > 0 ? ` · ${running} running` : ''}`
}

/**
 * The hands-off lines under the plan title: "Hands-off · <step>" once the PRD is approved and the plan is not closed
 * (a PRD edited since waits on the person, so it is not hands-off), and the pull request as the CLI recorded it:
 * "PR ready: <url>", or "PR draft · 2 not done: <url>" (the count is the recorded not-done entries; "PR draft: <url>" when none).
 */
export function handsOffLines(row: CairnPlanRow): string[] {
  const s = row.state
  const lines: string[] = []
  const isFixing = s.track === 'fix' && s.stage !== 'discover' && s.stage !== 'repro'
  if (s.stage !== 'closed' && row.ready?.kind !== 'prd' && (Boolean(s.approvals?.prd) || isFixing)) {
    lines.push(row.stepText !== undefined && row.stepText !== '' ? `Hands-off · ${row.stepText}` : 'Hands-off')
  }
  const pr = s.pullRequest
  if (pr !== undefined && pr !== null && typeof pr.url === 'string') {
    const n = typeof pr.notDone === 'number' ? pr.notDone : Array.isArray(s.notDone) ? s.notDone.length : 0
    lines.push(pr.draft === true ? `PR draft${n > 0 ? ` · ${n} not done` : ''}: ${pr.url}` : `PR ready: ${pr.url}`)
  }
  return lines
}

/** How many rows those lines take: inline they share one. */
export const handsOffRows = (row: CairnPlanRow, isInline: boolean) => (isInline ? Math.min(1, handsOffLines(row).length) : handsOffLines(row).length)

/** In Build: " · wrapping up phase", the CLI's step for the stage, after the phase text. */
function buildStep(row: CairnPlanRow): string {
  return row.state.stage === 'execute' && row.stepText !== undefined && row.stepText !== '' ? ` · ${row.stepText}` : ''
}

export const list = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x.filter(v => v !== null && typeof v === 'object') as T[]) : [])
export const phasesOf = (s: CairnPlanState) => list<Phase>(s.phases)
export const tasksOf = (s: CairnPlanState) => phasesOf(s).flatMap(p => list<Task>(p.tasks))
/** The index of the phase being built: the first not done; -1 once every phase is done. */
export const phaseAt = (s: CairnPlanState) => phasesOf(s).findIndex(p => p.status !== 'done')
export const stageOf = (s: CairnPlanState, prOpen?: boolean) => `${STAGE_LABEL[s.stage ?? ''] ?? String(s.stage ?? '?')}${prOpen === true ? ' · PR open' : ''}`
export const isActive = (r: CairnPlanRow) => r.state.stage !== 'closed'
/** True while the plan's agent has put a question to the person that only its own session can take. */
export const isAsking = (r: CairnPlanRow) => r.state.step?.name === 'asking' && r.state.step.stage === r.state.stage
/** The plans other than `here` that want the person: a document waits on approval, or the plan asks in its own session. */
export const waitingOn = (plans: CairnPlanRow[], here: string | undefined) =>
  plans.filter(r => r.state.slug !== here && (r.ready !== undefined || (isActive(r) && isAsking(r))))

/** "~40m left" in Build while tasks remain; otherwise nothing. */
export function etaText(row: CairnPlanRow, nowMs: number): string | undefined {
  const tasks = tasksOf(row.state)
  if (row.state.stage !== 'execute' || tasks.every(x => x.status === 'done')) return undefined
  const ms = etaMs(tasks, nowMs, row.maxParallel ?? DEFAULT_PARALLEL)
  return `~${fmtDuration(Math.ceil(ms / 60_000) * 60_000, true)} left`
}

/** `cairn · Build 9/19 tasks · 3 running · ~40m left`; away from a plan, how many are active. */
export async function statusLine($: EngineInterface, v: CairnView): Promise<string | undefined> {
  const row = v.plans.find(r => r.state.slug === v.here)
  const active = v.plans.filter(isActive).length
  const waiting = waitingOn(v.plans, v.here).length
  const waits = waiting === 0 ? '' : ` · ${waiting} plan${waiting === 1 ? ' waits' : 's wait'} on you`
  if (row === undefined) return active > 0 ? `${active} active plan${active === 1 ? '' : 's'}${waits}` : undefined
  const tasks = tasksOf(row.state)
  const working = (await readAgents($)).filter(c => c.status === 'working').length
  const late = LATE_STAGES.includes(row.state.stage ?? '')
  const parts = late ? [`${stageOf(row.state, row.prOpen)}${lateTail(row, working)}`, row.state.paused && 'paused'] : [
    tasks.length > 0 ? `${stageOf(row.state, row.prOpen)} ${tasks.filter(x => x.status === 'done').length}/${tasks.length} tasks` : stageOf(row.state, row.prOpen),
    working > 0 && `${working} running`,
    row.state.paused ? 'paused' : etaText(row, await $.clock.now()),
  ]
  return ['cairn', ...parts.filter(Boolean)].join(' · ') + waits
}

/**
 * The plan's title, stage and phase over its progress bar, in one Box so a gap never splits them.
 */
export function planHeader(ui: Ui, row: CairnPlanRow, accent: string, bodyColumns: number, nowMs: number, running = 0, isInline = false) {
  const { Box, Text } = ui
  const s = row.state
  const phases = phasesOf(s)
  const tasks = tasksOf(s)
  const at = phaseAt(s)
  const late = LATE_STAGES.includes(s.stage ?? '')
  const where = late ? lateTail(row, running) : `${phases.length === 0 || at < 0 ? '' : ` · phase ${at + 1} of ${phases.length}`}${buildStep(row)}`
  const done = tasks.filter(x => x.status === 'done').length
  const rest = row.ready?.kind !== undefined ? 'Waiting on you' : row.next?.text
  const label = [tasks.length > 0 && `${done}/${tasks.length} tasks`, s.stage === 'execute' ? etaText(row, nowMs) : rest].filter(Boolean).join(' · ')
  const bar = Math.min(20, Math.max(6, bodyColumns - 2 - label.length - 1))
  const filled = tasks.length === 0 ? 0 : Math.round((done / tasks.length) * bar)
  return (
    <Box key="header" flexDirection="column">
      <Text key="head" bold color={accent} wrap="truncate-end">{`${row.epic === undefined || row.epic === '' ? '' : `${clean(row.epic)} `}${s.title ?? s.slug} · ${stageOf(s, row.prOpen)}${where}${levelTail(row)}`}</Text>
      {isInline
        ? handsOffLines(row).length > 0 && <Text key="handsoff" color={accent} wrap="truncate-end">{clean(handsOffLines(row).join(' · '))}</Text>
        : handsOffLines(row).map((l, i) => <Text key={`handsoff:${i}`} color={accent} wrap="truncate-end">{clean(l)}</Text>)}
      {!!s.paused && <Text key="paused" color="yellow">{`Paused since ${(s.paused?.at ?? '?').slice(0, 10)}`}</Text>}
      {tasks.length > 0 ? <Text key="bar" color={accent} wrap="truncate-end">{`${'█'.repeat(filled)}${'░'.repeat(bar - filled)} ${label}`}</Text> : <Text key="bar" dimColor color={accent} wrap="truncate-end">{label}</Text>}
    </Box>
  )
}
