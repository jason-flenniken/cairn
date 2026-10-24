import { describe, expect, test } from 'claude-code/testing'
import type { CairnGit } from '../../types/index.d.ts'
import { gitLine, parseStatus } from '../mod/git.ts'
import { mount, plan, row, start, world, WT } from './world.tsx'

type El = { type: string; props: Record<string, unknown>; children: (El | string)[] }

const textOf = (n: El | string): string => (typeof n === 'string' ? n : n.children.map(textOf).join(''))
const width = (text: string) => [...text].reduce((n, ch) => n + (/\p{Emoji_Presentation}/u.test(ch) ? 2 : 1), 0)
const lineText = (line: { text: string }[]) => line.map(s => s.text).join('')

async function barRows(ui: any): Promise<string[]> {
  const bar = (await ui.find({ type: 'Box', key: 'statusbar' })) as El | undefined
  return bar === undefined ? [] : bar.children.map(textOf).map(r => r.trimEnd())
}

const CLEAN = '# branch.oid 0123456789abcdef\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n'
const DIRTY = [
  '# branch.oid 0123456789abcdef',
  '# branch.head feature/supplement-pdf-reports',
  '# branch.upstream origin/feature/supplement-pdf-reports',
  '# branch.ab +2 -1',
  '1 .M N... 100644 100644 100644 aaa bbb a.ts',
  '1 M. N... 100644 100644 100644 aaa bbb b.ts',
  '2 RM N... 100644 100644 100644 aaa bbb R100 c.ts\td.ts',
  'u UU N... 100644 100644 100644 100644 aaa bbb ccc e.ts',
  '? new.txt',
  '',
].join('\n')

const g = (over: Partial<CairnGit> = {}): CairnGit => ({
  branch: 'main', isDetached: false, hasUpstream: true, ahead: 0, behind: 0, staged: 0, changed: 0, untracked: 0, conflicts: 0, ...over,
})

describe('git status (parseStatus)', () => {
  test('a clean tree on a tracked branch', () => {
    expect(parseStatus(CLEAN)).toEqual({ branch: 'main', isDetached: false, hasUpstream: true, ahead: 0, behind: 0, staged: 0, changed: 0, untracked: 0, conflicts: 0 })
  })

  test('staged, changed, untracked and conflicted entries, ahead and behind', () => {
    expect(parseStatus(DIRTY)).toEqual({
      branch: 'feature/supplement-pdf-reports', isDetached: false, hasUpstream: true, ahead: 2, behind: 1, staged: 2, changed: 2, untracked: 1, conflicts: 1,
    })
  })

  test('a detached HEAD shows the short commit, and no upstream means no ahead or behind', () => {
    expect(parseStatus('# branch.oid 0123456789abcdef\n# branch.head (detached)\n')).toMatchObject({ branch: '0123456', isDetached: true, hasUpstream: false })
  })

  test('text with no branch header is not a status', () => {
    expect(parseStatus('/repo/.git\n')).toBeUndefined()
  })
})

describe('git line', () => {
  test('clean: the branch, ✓ clean, and the active time at the right edge', () => {
    const line = lineText(gitLine(g(), 72 * 60_000, 46))
    expect(line).toMatch(/^⎇ main {2}✓ clean +⏱ 1h 12m$/)
    expect(width(line)).toBe(46)
  })

  test('dirty, in a worktree: 🌳, the counts, ahead and behind', () => {
    const line = lineText(gitLine(g({ worktree: 'sdlc-shop', staged: 1, changed: 2, untracked: 1, conflicts: 1, ahead: 2, behind: 1 }), undefined, 46))
    expect(line).toBe('⎇ 🌳 sdlc-shop  ●3 +1 !1 ↑2 ↓1')
  })

  test('the worst case fits 46 columns and keeps the timer; a long branch shrinks in the middle', () => {
    const worst = g({ branch: 'feature/a-very-long-branch-name-that-goes-on-and-on', staged: 120, changed: 30, untracked: 999, conflicts: 12, ahead: 340, behind: 77 })
    const line = lineText(gitLine(worst, (10 * 60 + 59) * 60_000, 46))
    expect(width(line)).toBeLessThanOrEqual(46)
    expect(line).toContain('⏱ 10h 59m')
    expect(line).toMatch(/^⎇ feature\/a…n-and-on {2}●150 \+999 !12 +⏱ 10h 59m$/)
  })

  test('no repo: only the timer; no repo and no time: nothing', () => {
    expect(lineText(gitLine(null, 5 * 60_000, 46))).toBe('⏱ 5m')
    expect(gitLine(null, undefined, 46)).toEqual([])
  })
})

describe('git in the pane', () => {
  test('docked, the git line sits between the stage steps and the model line, with 🌳 in a linked worktree', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(plan({ stage: 'execute' }), WT)] })
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 24_000, window: 200_000, percent: 12 }, rateLimits: [], cost: { usd: 1 } } as never }))
    on('session.model', () => ({ value: 'claude-opus-5-5' as never }))
    w.git = DIRTY
    w.gitDirs = '/repo/.git/worktrees/sdlc-shop\n/repo/.claude/worktrees/sdlc-shop'
    await start($, WT)
    const ui = await mount($, 'terminal')
    await clock.advance(2_000)
    const rows = await barRows(ui)
    const at = rows.findIndex(r => r.startsWith('⎇ 🌳 sdlc-shop'))
    expect(at).toBeGreaterThan(rows.findIndex(r => r.includes('● Build')))
    expect(at).toBeLessThan(rows.findIndex(r => r.startsWith('🧠')))
    expect(rows[at]).toContain('●4 +1 !1 ↑2 ↓1')
    await ui.unmount()
  })

  test('in the main checkout the branch shows with no 🌳', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(plan({ stage: 'execute' }), WT)] })
    w.git = CLEAN
    await start($, WT)
    const ui = await mount($, 'terminal')
    await clock.advance(2_000)
    expect((await barRows(ui)).some(r => /^⎇ main {2}✓ clean/.test(r))).toBe(true)
    await ui.unmount()
  })

  test('idle, git is read at most every 30 s; while a turn runs, every 5 s; a finished turn reads on the next poll', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(plan({ stage: 'execute' }), WT)] })
    w.git = CLEAN
    await start($, WT)
    await clock.advance(2_000)
    const first = w.gitReads
    expect(first).toBe(1)
    for (let i = 0; i < 10; i++) await clock.advance(2_000)
    expect(w.gitReads).toBe(first)
    for (let i = 0; i < 5; i++) await clock.advance(2_000)
    expect(w.gitReads).toBe(first + 1)
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    const busy = w.gitReads
    for (let i = 0; i < 8; i++) await clock.advance(2_000)
    expect(w.gitReads - busy).toBeGreaterThanOrEqual(2)
    expect(w.gitReads - busy).toBeLessThanOrEqual(3)
    await $.turn.complete({ turnId: 'turn-1', reason: 'answer', answer: 'done' } as never)
    const done = w.gitReads
    await clock.advance(2_000)
    expect(w.gitReads).toBe(done + 1)
  })
})
