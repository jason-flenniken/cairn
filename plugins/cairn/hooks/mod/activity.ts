// What the agents are doing right now, for the pane's cards, and the ETA (FR-08..FR-12).
// Bookkeeping only: it never denies, never throws, and a hook of it that fails is skipped (NFR-07).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, SessionStartInput, Timer } from 'claude-code'
import type { AgentCard } from '../../types/index.d.ts'

// What the pane draws lives in $.state, so a hot reload keeps the cards.
const agents = atom({ plugin: 'cairn', key: 'agents' } as const, [] as AgentCard[])
const mainActivity = atom({ plugin: 'cairn', key: 'mainActivity' } as const, null as { action: string; since: number } | null)
const feed = atom({ plugin: 'cairn', key: 'feed' } as const, [] as { at: number; text: string }[])
const now = atom({ plugin: 'cairn', key: 'now' } as const, 0)

const TICK_MS = 1_000
const FEED_KEPT = 200
const KEEP_ENDED_MS = 120_000
/** How long a finished card stays on screen; a failure stays longer so it is not missed. */
export const LINGER_MS = { done: 10_000, failed: 60_000 }
const ACTIVE = ['running', 'pending', 'waiting']

let ticking: Timer | undefined

// Function declarations, not arrows: the engine follows `$` across an import only into a function declaration.
export function readAgents($: EngineInterface): Promise<AgentCard[]> {
  return read($, agents)
}
export function readMain($: EngineInterface): Promise<{ action: string; since: number } | null> {
  return read($, mainActivity)
}
export function readFeed($: EngineInterface): Promise<{ at: number; text: string }[]> {
  return read($, feed)
}
/** Read by the pane's render so the tick redraws it; the time itself comes from $.clock.now(). */
export function readTick($: EngineInterface): Promise<number> {
  return read($, now)
}

const safe = async (work: () => Promise<unknown>): Promise<void> => {
  try {
    await work()
  } catch {
    // Bookkeeping must never reach the tool, turn or spawn it watches.
  }
}

/** 6m 12s, 45s, 1h 05m; coarse drops the seconds under an hour (12m). */
export function fmtDuration(ms: number, isCoarse = false): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (isCoarse) return `${Math.max(1, Math.round(total / 60))}m`
  return m > 0 ? `${m}m ${total % 60}s` : `${total}s`
}

const last2 = (path: string) => path.split('/').filter(Boolean).slice(-2).join('/')

/** The plain-words phrase for a tool call, as the card's current action. */
export function phrase(e: Record<string, unknown>): string {
  const tool = String(e.tool)
  const text = (key: string) => (typeof e[key] === 'string' ? (e[key] as string) : '')
  switch (tool) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `editing ${last2(text('file_path') || text('notebook_path'))}`
    case 'Read':
      return `reading ${last2(text('file_path'))}`
    case 'Grep':
    case 'Glob':
      return 'searching'
    case 'Agent':
    case 'Task':
      return 'starting an agent'
    case 'Bash': {
      const cmd = text('command').trim().replace(/\s+/g, ' ')
      if (/npm (run )?test| test|cairn task done/.test(cmd)) return 'running tests'
      if (/git merge/.test(cmd)) return 'merging'
      if (/cairn/.test(cmd)) return 'updating the plan'
      return cmd.slice(0, 40)
    }
  }
  return tool.toLowerCase()
}

const FALLBACK_MIN: Record<string, number> = { simple: 5, standard: 12, complex: 25 }
export type EtaTask = { id?: string; status?: string; complexity?: string; startedAt?: string; doneAt?: string; blockedBy?: unknown }

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? (s[(s.length - 1) / 2] as number) : ((s[s.length / 2 - 1] as number) + (s[s.length / 2] as number)) / 2
}

/** How long the plan has left, in ms: the not-done tasks' estimates less what the running ones have spent, spread over the parallel lanes. */
export function etaMs(tasks: EtaTask[], nowMs: number, maxParallel = 3): number {
  const spans = new Map<string, number[]>()
  for (const x of tasks) {
    const span = Date.parse(x.doneAt ?? '') - Date.parse(x.startedAt ?? '')
    if (x.status === 'done' && span >= 0) spans.set(x.complexity ?? '', [...(spans.get(x.complexity ?? '') ?? []), span])
  }
  const estimate = (x: EtaTask) => {
    const seen = spans.get(x.complexity ?? '')
    return seen ? median(seen) : (FALLBACK_MIN[x.complexity ?? 'standard'] ?? 12) * 60_000
  }
  const doneIds = new Set(tasks.filter(x => x.status === 'done').map(x => x.id))
  let remaining = 0
  let lanes = 0
  for (const x of tasks) {
    if (x.status === 'done') continue
    if (x.status === 'in_progress') {
      lanes++
      const spent = nowMs - Date.parse(x.startedAt ?? '')
      remaining += Math.max(0, estimate(x) - (Number.isNaN(spent) ? 0 : spent))
    } else {
      if ((Array.isArray(x.blockedBy) ? x.blockedBy : []).every(b => doneIds.has(b as string))) lanes++
      remaining += estimate(x)
    }
  }
  return remaining / Math.min(maxParallel, Math.max(1, lanes))
}

/** True while something moves on screen: the main session, a working card, or a finished card still lingering. */
async function isBusy($: EngineInterface): Promise<boolean> {
  const t = await $.clock.now()
  return (await read($, mainActivity)) !== null || (await read($, agents)).some(c => c.status === 'working' || t - (c.endedAt ?? 0) < LINGER_MS[c.status])
}

/** Stamps `now`, which redraws the pane, and makes sure the tick runs; the tick stops itself once nothing is active. */
async function touch($: EngineInterface): Promise<void> {
  const t = await $.clock.now()
  await update($, now, () => t)
  ticking ??= $.clock.every(TICK_MS, () => void tick($).catch(() => undefined))
}

async function tick($: EngineInterface): Promise<void> {
  const t = await $.clock.now()
  // One last redraw as the tick stops, so a card that just lapsed drops off.
  await update($, now, () => t)
  if (await isBusy($)) return
  ticking?.cancel()
  ticking = undefined
}

function patch($: EngineInterface, id: string, fn: (c: AgentCard) => AgentCard): Promise<unknown> {
  return update($, agents, list => list.map(c => (c.agentId === id ? fn(c) : c)))
}

type Call = { agentId?: string } & Record<string, unknown>

/** A tool call is about to run: its card, or the main session, shows the phrase. */
export function before($: EngineInterface, e: Call): Promise<void> {
  return safe(async () => {
    const t = await $.clock.now()
    const action = phrase(e)
    if (e.agentId === undefined) await update($, mainActivity, () => ({ action, since: t }))
    else await patch($, e.agentId, c => ({ ...c, action, actionSince: t }))
    await touch($)
  })
}

/** The call ended: a step for the card, and the main session goes back to thinking. */
export function after($: EngineInterface, e: Call): Promise<void> {
  return safe(async () => {
    const t = await $.clock.now()
    if (e.agentId === undefined) await update($, mainActivity, m => (m === null ? m : { action: 'thinking', since: t }))
    else await patch($, e.agentId, c => ({ ...c, steps: c.steps + 1, action: undefined, actionSince: undefined }))
  })
}

/** A turn began: the main session is thinking; an agent whose card finished is working again. */
export function turnStart($: EngineInterface, e: { agentId?: string }): Promise<void> {
  return safe(async () => {
    const t = await $.clock.now()
    if (e.agentId === undefined) await update($, mainActivity, () => ({ action: 'thinking', since: t }))
    else await patch($, e.agentId, c => (c.status === 'working' ? c : { ...c, status: 'working', startedAt: t, endedAt: undefined, durationMs: undefined, tokens: undefined }))
    await touch($)
  })
}

type Complete = { agentId?: string; reason?: string; durationMs?: number; usage?: { input_tokens: number; output_tokens: number } }

/** A turn ended: the main session goes idle; an agent's card finishes, with a line in the feed. */
export function turnComplete($: EngineInterface, e: Complete): Promise<void> {
  return safe(async () => {
    const t = await $.clock.now()
    if (e.agentId === undefined) return void (await update($, mainActivity, () => null))
    const id = e.agentId
    const card = (await read($, agents)).find(c => c.agentId === id)
    if (card === undefined) return
    const ok = e.reason === 'answer'
    const durationMs = e.durationMs ?? t - card.startedAt
    const tokens = e.usage ? e.usage.input_tokens + e.usage.output_tokens : undefined
    await update($, agents, list =>
      list
        .filter(c => c.status === 'working' || c.endedAt === undefined || t - c.endedAt < KEEP_ENDED_MS)
        .map(c => (c.agentId === id ? { ...c, status: ok ? 'done' : 'failed', endedAt: t, durationMs, tokens, action: undefined } : c)),
    )
    const size = tokens === undefined ? '' : ` · ${tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : tokens} tokens`
    const line = `${ok ? 'Finished' : 'Stopped'} ${card.title} · ${fmtDuration(durationMs, true)}${size}`
    await update($, feed, f => [...f, { at: t, text: line }].slice(-FEED_KEPT))
    await touch($)
  })
}

/** Called by register.tsx's single session.start: after a reload, cards come back from the engine's agent list. */
export async function onSessionStart($: EngineInterface, _e: SessionStartInput): Promise<void> {
  ticking?.cancel()
  ticking = undefined
  if ((await read($, agents)).length === 0) {
    const t = await $.clock.now()
    const live = (await $.agent.list()).filter(a => ACTIVE.includes(a.status))
    const cards: AgentCard[] = live.map(a => ({ agentId: a.id, title: a.description, type: a.type, model: '', startedAt: t, steps: 0, status: 'working' }))
    await update($, agents, () => cards)
  }
  if (await isBusy($)) await touch($)
}

export function install(on: On): void {
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    await safe(async () => {
      if (r.deny !== undefined || r.agentId === undefined) return
      const id = r.agentId
      const t = await $.clock.now()
      const card: AgentCard = { agentId: id, title: e.description, type: e.subagentType, model: r.model, startedAt: t, steps: 0, status: 'working' }
      await update($, agents, list => [...list.filter(c => c.agentId !== id), card])
      await touch($)
    })
    return r
  })
}
