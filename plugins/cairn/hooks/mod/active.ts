// The shown plan's active time: only while the main turn or an agent works, never while a question
// waits on the user, the plan is paused, or the session is idle. Kept per machine in $.store.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import { readAgents } from './activity.ts'
import { isDialogOpen } from './approve.ts'
import { turnRunning } from './pause.ts'

// What the bar draws lives in $.state, so a hot reload keeps it.
const activeTime = atom({ plugin: 'cairn', key: 'activeTime' } as const, null as { slug: string; ms: number } | null)

/** A longer gap between polls (a sleeping laptop, a stalled loop) adds no more than this. */
export const MAX_STEP_MS = 5_000
/** How often a growing total is saved; a crash loses at most this much. */
export const SAVE_EVERY_MS = 15_000

// Bookkeeping, not drawn: the last poll's time, and what is counted but not saved yet.
let lastAt: number | undefined
let unsaved = 0
let savedAt = 0
let key: string | undefined

const storeKey = (common: string, slug: string) => `active:${common}:${slug}`

/** The main turn runs or an agent card works. */
export async function isWorking($: EngineInterface): Promise<boolean> {
  return turnRunning() || (await readAgents($)).some(c => c.status === 'working')
}

export function readActive($: EngineInterface): Promise<{ slug: string; ms: number } | null> {
  return read($, activeTime)
}

async function stored($: EngineInterface, k: string): Promise<number> {
  const v = await $.store.get(k).catch(() => undefined)
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

/** Adds what was counted since the last save to the stored total: another session's time on the plan stays. */
async function save($: EngineInterface, nowMs: number): Promise<void> {
  if (key === undefined || unsaved === 0) return
  const k = key
  const delta = unsaved
  unsaved = 0
  savedAt = nowMs
  await $.store.set(k, (await stored($, k)) + delta).catch(() => {
    unsaved += delta
  })
}

/**
 * One poll's share: when the shown plan is active, not paused, something works and no question is
 * open, the time since the last poll (at most MAX_STEP_MS) is added. A new plan loads its stored total.
 */
export async function trackActive($: EngineInterface, common: string | undefined, slug: string | undefined, isPaused: boolean): Promise<void> {
  const nowMs = await $.clock.now()
  const step = lastAt === undefined ? 0 : Math.min(MAX_STEP_MS, Math.max(0, nowMs - lastAt))
  lastAt = nowMs
  const k = common === undefined || slug === undefined ? undefined : storeKey(common, slug)
  if (k !== key) {
    await save($, nowMs)
    key = k
    savedAt = nowMs
    const shown = k === undefined || slug === undefined ? null : { slug, ms: await stored($, k) }
    await update($, activeTime, () => shown)
    return
  }
  if (slug === undefined || isPaused || isDialogOpen() || !(await isWorking($))) {
    // The first poll that stops counting saves the rest, so quitting after a turn loses none of it.
    await save($, nowMs)
    return
  }
  unsaved += step
  await update($, activeTime, cur => (cur === null ? cur : { ...cur, ms: cur.ms + step }))
  if (nowMs - savedAt >= SAVE_EVERY_MS) await save($, nowMs)
}

/** A session start saves what is still unsaved and counts from its own first poll, loading the plan's total again. */
export async function startActive($: EngineInterface): Promise<void> {
  await save($, await $.clock.now()).catch(() => undefined)
  lastAt = undefined
  key = undefined
  unsaved = 0
}
