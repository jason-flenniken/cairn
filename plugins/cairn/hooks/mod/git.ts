// The session folder's git state for the bar's git line: branch or worktree, the tree, ahead and behind,
// with the plan's active time at the right. Read from the pane's poll, never from a hook.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, ProcessRunInit } from 'claude-code'
import type { CairnGit } from '../../types/index.d.ts'
import { BAR_COLUMNS, type BarLine, type BarSeg } from './bar.tsx'
import { cells, firstFit, fmtDuration, lineCells } from './util.ts'

// What the bar draws lives in $.state, so a hot reload keeps it.
const git = atom({ plugin: 'cairn', key: 'git' } as const, null as CairnGit | null)

/** How often the git state is read again: while something works, and while idle. */
export const BUSY_EVERY_MS = 5_000
export const IDLE_EVERY_MS = 30_000
const BRANCH_MIN = 12
const GAP = '  '
const quick: ProcessRunInit = { timeoutMs: 10_000 }

// Bookkeeping, not drawn: when git was last read, and whether a finished turn asked for a read now.
let readAt: number | undefined
let isStale = false

/** A main turn finished: its commits and edits show on the next poll rather than up to 30 s later. */
export function markGitStale(): void {
  isStale = true
}

export function readGit($: EngineInterface): Promise<CairnGit | null> {
  return read($, git)
}

/** `git status --porcelain=v2 --branch` as counts; undefined when the text has no branch header. */
export function parseStatus(text: string): Omit<CairnGit, 'worktree'> | undefined {
  let head: string | undefined
  let oid: string | undefined
  const out = { hasUpstream: false, ahead: 0, behind: 0, staged: 0, changed: 0, untracked: 0, conflicts: 0 }
  for (const line of text.split('\n')) {
    const [tag, ...rest] = line.split(' ')
    if (tag === '#') {
      const [name, ...value] = rest
      if (name === 'branch.head') head = value.join(' ')
      else if (name === 'branch.oid') oid = value[0]
      else if (name === 'branch.upstream') out.hasUpstream = true
      else if (name === 'branch.ab') {
        out.ahead = Math.abs(Number.parseInt(value[0] ?? '0', 10)) || 0
        out.behind = Math.abs(Number.parseInt(value[1] ?? '0', 10)) || 0
      }
    } else if (tag === '1' || tag === '2') {
      // XY: X is the index (staged), Y the work tree (changed); "." is unchanged.
      const xy = rest[0] ?? '..'
      if (xy[0] !== '.') out.staged++
      if (xy[1] !== '.') out.changed++
    } else if (tag === 'u') out.conflicts++
    else if (tag === '?') out.untracked++
  }
  if (head === undefined) return undefined
  const isDetached = head === '(detached)'
  return { branch: isDetached ? (oid ?? '').slice(0, 7) || 'detached' : head, isDetached, ...out }
}

/** Reads the session folder's git state; a failed read keeps the last one. */
async function refresh($: EngineInterface, common: string): Promise<void> {
  const cwd = await $.session.cwd()
  const status = await $.process.run(['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'], { ...quick, cwd }).catch(() => undefined)
  if (status?.exitCode !== 0) return
  const parsed = parseStatus(status.stdout)
  if (parsed === undefined) return
  const dirs = await $.process.run(['git', 'rev-parse', '--absolute-git-dir', '--show-toplevel'], { ...quick, cwd }).catch(() => undefined)
  const [gitDir, top] = dirs?.exitCode === 0 ? dirs.stdout.trim().split('\n') : []
  // A linked worktree has its own git dir under the common one.
  const worktree = gitDir !== undefined && top !== undefined && gitDir !== common ? top.split('/').filter(Boolean).pop() : undefined
  await update($, git, () => ({ ...parsed, ...(worktree === undefined ? {} : { worktree }) }))
}

/** Called from the pane's poll: reads git every BUSY_EVERY_MS while something works, else every IDLE_EVERY_MS. */
export async function trackGit($: EngineInterface, common: string | undefined, isBusy: boolean): Promise<void> {
  if (common === undefined) return
  const nowMs = await $.clock.now()
  const every = isBusy ? BUSY_EVERY_MS : IDLE_EVERY_MS
  if (!isStale && readAt !== undefined && nowMs - readAt < every) return
  readAt = nowMs
  isStale = false
  await refresh($, common)
}

/** The text cut to `max` cells with a middle "…", so both ends of a branch name stay readable. */
function middle(text: string, max: number): string {
  const chars = [...text]
  if (cells(text) <= max) return text
  const head = Math.ceil((max - 1) / 2)
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - (max - 1 - head)).join('')}`
}

/**
 * The git line: ⎇ (🌳 in a linked worktree) and the branch, the tree, ↑ahead ↓behind, and the plan's
 * active time at the right. To fit, the branch shrinks first, then "clean" becomes ✓, then ahead/behind go.
 */
export function gitLine(g: CairnGit | null, activeMs: number | undefined, columns = BAR_COLUMNS): BarLine {
  const timer: BarSeg[] = activeMs !== undefined && activeMs > 0 ? [{ text: `⏱ ${fmtDuration(activeMs, true)}`, dim: true }] : []
  if (g === null) return timer
  const isClean = g.staged + g.changed + g.untracked + g.conflicts === 0
  const name = g.worktree ?? g.branch
  const build = (withWord: boolean, withAb: boolean): BarLine => {
    const tree: BarSeg[] = isClean
      ? [{ text: withWord ? '✓ clean' : '✓', color: 'success' }]
      : [
          ...(g.staged + g.changed > 0 ? [{ text: `●${g.staged + g.changed}`, color: 'warning' }] : []),
          ...(g.untracked > 0 ? [{ text: `+${g.untracked}`, dim: true }] : []),
          ...(g.conflicts > 0 ? [{ text: `!${g.conflicts}`, color: 'error' }] : []),
        ]
    const ab: BarSeg[] = withAb && g.hasUpstream
      ? [...(g.ahead > 0 ? [{ text: `↑${g.ahead}` }] : []), ...(g.behind > 0 ? [{ text: `↓${g.behind}` }] : [])]
      : []
    const left = (shown: string): BarLine =>
      [{ text: `⎇ ${g.worktree === undefined ? '' : '🌳 '}${shown}`, bold: true }, ...tree, ...ab]
        .flatMap((seg, i) => (i === 0 ? [seg] : [{ text: i === 1 ? GAP : ' ' }, seg]))
    // The name takes what the rest leaves, never less than BRANCH_MIN; the timer keeps a gap before it.
    const rest = lineCells(left('')) + (timer.length === 0 ? 0 : cells(GAP) + lineCells(timer))
    const line = left(middle(name, Math.max(BRANCH_MIN, columns - rest)))
    if (timer.length === 0) return line
    return [...line, { text: ' '.repeat(Math.max(cells(GAP), columns - lineCells(line) - lineCells(timer))) }, ...timer]
  }
  return firstFit([build(true, true), build(false, true), build(false, false)], columns)
}

/** A session start reads git on its first poll. */
export function startGit(): void {
  readAt = undefined
  isStale = false
}
