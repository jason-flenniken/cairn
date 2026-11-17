// The one plan this session works on. A session approves, changes the level of, overrides, pauses and shows
// as its own only this plan, so sessions running different plans in one repo never act on each other's.
// A session's folder is often not the plan's worktree (an Orca workspace, the repo root), so the mod
// remembers the plan per session in $.store, which outlives a /reload-plugins.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { CairnPlanState } from '../../types/index.d.ts'
import { tasksOf } from './header.tsx'

export type OwnRow = { state?: { slug?: string; stage?: string }; worktree?: string }

const isUnder = (cwd: string, dir: string | undefined) => !!dir && (cwd === dir || cwd.startsWith(`${dir}/`))

/** The plan's own worktree and its tasks' worktrees. */
function worktreesOf(r: OwnRow): string[] {
  const tasks = r.state === undefined ? [] : tasksOf(r.state as CairnPlanState).map(x => x.worktree)
  return [r.worktree, ...tasks].filter((d): d is string => typeof d === 'string' && d !== '')
}

/** The plan whose worktree (or one of whose task worktrees) holds `cwd`, the deepest match winning. */
export function hereSlug(rows: readonly OwnRow[], cwd: string): string | undefined {
  let best: { slug: string; depth: number } | undefined
  for (const r of rows) {
    const slug = r.state?.slug
    if (slug === undefined) continue
    for (const dir of worktreesOf(r)) {
      if (isUnder(cwd, dir) && (best === undefined || dir.length > best.depth)) best = { slug, depth: dir.length }
    }
  }
  return best?.slug
}

/**
 * The one plan whose worktree a command names: a path ends at the end of the text, a slash, a space, a quote or a
 * shell operator, so `feature-x` is not read out of `feature-x-y` or `feature-x--task`. Two plans named is none.
 */
export function namedPlan(rows: readonly OwnRow[], command: string): string | undefined {
  const found: { slug: string; at: number; length: number }[] = []
  for (const r of rows) {
    const slug = r.state?.slug
    if (slug === undefined) continue
    for (const dir of worktreesOf(r)) {
      for (let at = command.indexOf(dir); at !== -1; at = command.indexOf(dir, at + 1)) {
        const after = command[at + dir.length]
        if (after === undefined || /[\s/'";&|)]/.test(after)) found.push({ slug, at, length: dir.length })
      }
    }
  }
  // A plan kept in the main checkout holds every other worktree under it: the longest path at a spot is the one named.
  const named = new Set(found.filter(m => !found.some(n => n.at === m.at && n.length > m.length)).map(m => m.slug))
  return named.size === 1 ? [...named][0] : undefined
}

// The session's plan for this engine, under the session id it was set for. $.store keeps it across a reload.
// `inferred`: taken from the session's folder alone, not claimed by a cairn command or an approval question. The
// $.store value is the slug, with a trailing `?` for an inferred one (a plain slug, from before, counts as claimed).
const bound = atom({ plugin: 'cairn', key: 'ownPlan' } as const, null as { key: string; slug: string; inferred?: boolean } | null)

async function storeKey($: EngineInterface): Promise<string> {
  return `own-plan:${await $.session.id().catch(() => 'session')}`
}

async function storedPlan($: EngineInterface): Promise<string | undefined> {
  const key = await storeKey($)
  const held = await read($, bound)
  if (held?.key === key) return held.slug
  const v = await $.store.get(key).catch(() => undefined)
  if (typeof v !== 'string') return undefined
  const inferred = v.endsWith('?')
  const slug = inferred ? v.slice(0, -1) : v
  await update($, bound, () => ({ key, slug, inferred }))
  return slug
}

/** The session's binding as `storedPlan` left it in the atom. */
async function storedBinding($: EngineInterface): Promise<{ slug: string; inferred: boolean } | undefined> {
  const slug = await storedPlan($)
  const held = await read($, bound)
  return slug === undefined || held === null ? undefined : { slug, inferred: held.inferred === true }
}

/** True while the session's plan comes from its folder alone: a cairn command in that folder then makes it a claim. */
export async function isInferred($: EngineInterface): Promise<boolean> {
  return (await storedBinding($))?.inferred === true
}

/** True when the session's own plan is `slug` and a cairn command or an approval question made it so, not the folder alone. */
export async function isClaimed($: EngineInterface, slug: string): Promise<boolean> {
  const b = await storedBinding($)
  return b?.slug === slug && !b.inferred
}

async function store($: EngineInterface, slug: string, inferred = false): Promise<void> {
  const key = await storeKey($)
  await update($, bound, () => ({ key, slug, inferred }))
  await $.store.set(key, inferred ? `${slug}?` : slug).catch(() => undefined)
}

/** The plan this session last worked on, closed or not: a plan closes before its pull request merges. */
export async function lastOwnPlan($: EngineInterface): Promise<string | undefined> {
  return storedPlan($)
}

const isOpen = (r: OwnRow | undefined) => r !== undefined && r.state?.stage !== 'closed'

/**
 * The session's plan: the stored one while it is listed and not closed; else the one whose worktree the session's
 * folder is in (which then becomes the stored one); else the only plan not closed. Never a guess among several.
 * A stored plan wins over the folder, so a session that changes folder into another plan's worktree keeps its own.
 */
export async function ownPlan($: EngineInterface, rows: readonly OwnRow[]): Promise<string | undefined> {
  const stored = await storedPlan($)
  if (stored !== undefined && isOpen(rows.find(r => r.state?.slug === stored))) return stored
  const here = hereSlug(rows, await $.session.cwd().catch(() => ''))
  if (here !== undefined) {
    await store($, here, true)
    return here
  }
  const open = rows.filter(r => r.worktree !== undefined && isOpen(r))
  return open.length === 1 ? open[0]?.state?.slug : undefined
}

/**
 * Makes `slug` the session's plan when it has none of its own yet: none stored (or the stored one closed or gone)
 * and its folder in no plan's worktree. A session already on a live plan keeps it. Answers the session's plan after.
 */
export async function claimPlan($: EngineInterface, slug: string, rows: readonly OwnRow[]): Promise<string | undefined> {
  const here = hereSlug(rows, await $.session.cwd().catch(() => ''))
  const stored = await storedPlan($)
  const isHeld = here !== undefined || (stored !== undefined && isOpen(rows.find(r => r.state?.slug === stored)))
  if (!isHeld && rows.some(r => r.state?.slug === slug)) {
    // Two questions answered at once may both find no plan held: the first to land keeps it.
    const key = await storeKey($)
    let isFirst = false
    await update($, bound, cur => {
      if (cur !== null && cur.key === key && cur.slug !== stored) return cur
      isFirst = true
      return { key, slug }
    })
    if (isFirst) await $.store.set(key, slug).catch(() => undefined)
  }
  const own = await ownPlan($, rows)
  // Claiming the plan the session already holds from its folder makes the hold a claim.
  if (own === slug && (await read($, bound))?.inferred === true) await store($, slug)
  return own
}
