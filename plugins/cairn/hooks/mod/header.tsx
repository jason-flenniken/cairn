// The plan header the pane draws over Now (FR-09), the status line `$.ui.status` shows (FR-11),
// and the plan-reading helpers the other pane modules share.
import type { Elements, EngineInterface, RenderSurface } from 'claude-code'
import type { CairnPlanRow, CairnPlanState, CairnView } from '../../types/index.d.ts'
import { etaMs, fmtDuration, readAgents, type EtaTask } from './activity.ts'

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

/** After Build: " · fixing 3 findings", then " · 2 running" while agents work. */
export function lateTail(row: CairnPlanRow, running: number): string {
  if (!LATE_STAGES.includes(row.state.stage ?? '')) return ''
  const step = row.stepText
  return `${step !== undefined ? ` · ${step}` : ''}${running > 0 ? ` · ${running} running` : ''}`
}

export const list = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x.filter(v => v !== null && typeof v === 'object') as T[]) : [])
export const phasesOf = (s: CairnPlanState) => list<Phase>(s.phases)
export const tasksOf = (s: CairnPlanState) => phasesOf(s).flatMap(p => list<Task>(p.tasks))
/** The index of the phase being built: the first not done; -1 once every phase is done. */
export const phaseAt = (s: CairnPlanState) => phasesOf(s).findIndex(p => p.status !== 'done')
export const stageOf = (s: CairnPlanState, prOpen?: boolean) => `${STAGE_LABEL[s.stage ?? ''] ?? String(s.stage ?? '?')}${prOpen === true ? ' · PR open' : ''}`
export const isActive = (r: CairnPlanRow) => r.state.stage !== 'closed'

/** "~40m left" in Build while tasks remain; otherwise nothing. */
export function etaText(row: CairnPlanRow, nowMs: number): string | undefined {
  const tasks = tasksOf(row.state)
  if (row.state.stage !== 'execute' || tasks.every(x => x.status === 'done')) return undefined
  const ms = etaMs(tasks, nowMs, row.maxParallel ?? DEFAULT_PARALLEL)
  return `~${fmtDuration(Math.ceil(ms / 60_000) * 60_000, true)} left`
}

/** `cairn · Build 9/19 tasks · 3 working · ~40m left`; away from a plan, how many are active. */
export async function statusLine($: EngineInterface, v: CairnView): Promise<string | undefined> {
  const row = v.isFallback ? undefined : v.plans.find(r => r.state.slug === v.here)
  const active = v.plans.filter(isActive).length
  if (row === undefined) return active > 0 ? `${active} active plan${active === 1 ? '' : 's'}` : undefined
  const tasks = tasksOf(row.state)
  const working = (await readAgents($)).filter(c => c.status === 'working').length
  const late = LATE_STAGES.includes(row.state.stage ?? '')
  const parts = late ? [`${stageOf(row.state, row.prOpen)}${lateTail(row, working)}`, row.state.paused && 'paused'] : [
    tasks.length > 0 ? `${stageOf(row.state, row.prOpen)} ${tasks.filter(x => x.status === 'done').length}/${tasks.length} tasks` : stageOf(row.state, row.prOpen),
    working > 0 && `${working} working`,
    row.state.paused ? 'paused' : etaText(row, await $.clock.now()),
  ]
  return ['cairn', ...parts.filter(Boolean)].join(' · ')
}

/**
 * The plan's title, stage and phase over its progress bar, in one Box so a gap never splits them.
 * `fallback` is the active-plan count when the view chose the plan from the repo root.
 */
export function planHeader(ui: Ui, row: CairnPlanRow, accent: string, bodyColumns: number, nowMs: number, fallback?: number, running = 0) {
  const { Box, Text } = ui
  const s = row.state
  const phases = phasesOf(s)
  const tasks = tasksOf(s)
  const at = phaseAt(s)
  const late = LATE_STAGES.includes(s.stage ?? '')
  const where = late ? lateTail(row, running) : phases.length === 0 ? '' : at < 0 ? '' : ` · phase ${at + 1} of ${phases.length}`
  const done = tasks.filter(x => x.status === 'done').length
  const rest = row.ready?.kind !== undefined ? 'Waiting on you' : row.next?.text
  const label = [tasks.length > 0 && `${done}/${tasks.length} tasks`, s.stage === 'execute' ? etaText(row, nowMs) : rest].filter(Boolean).join(' · ')
  const bar = Math.min(20, Math.max(6, bodyColumns - 2 - label.length - 1))
  const filled = tasks.length === 0 ? 0 : Math.round((done / tasks.length) * bar)
  return (
    <Box key="header" flexDirection="column">
      <Text key="head" bold color={accent} wrap="truncate-end">{`${s.title ?? s.slug} · ${stageOf(s, row.prOpen)}${where}`}</Text>
      {fallback !== undefined && <Text key="fallback" dimColor wrap="truncate-end">{`Showing ${s.slug}, ${fallback > 1 ? 'the most recently updated of the active plans' : 'the active plan'}`}</Text>}
      {!!s.paused && <Text key="paused" color="yellow">{`Paused since ${(s.paused?.at ?? '?').slice(0, 10)}`}</Text>}
      {tasks.length > 0 ? <Text key="bar" color={accent} wrap="truncate-end">{`${'█'.repeat(filled)}${'░'.repeat(bar - filled)} ${label}`}</Text> : <Text key="bar" dimColor color={accent} wrap="truncate-end">{label}</Text>}
    </Box>
  )
}
