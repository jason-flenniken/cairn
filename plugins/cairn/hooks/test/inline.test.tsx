import { describe, expect, test } from 'claude-code/testing'
import { MAIN, mountAs, plan, ready, row, start, world, WT } from './world.tsx'

type El = { type: string; props: Record<string, unknown>; children: (El | string)[] }

const OTHER = '/repo/.claude/worktrees/sdlc-other'
const textOf = (n: El | string): string => (typeof n === 'string' ? n : n.children.map(textOf).join(''))
const rowsOf = (n: El): number =>
  n.type === 'Box' && n.props.flexDirection === 'column' ? n.children.reduce((k: number, c) => k + (typeof c === 'string' ? 1 : rowsOf(c)), 0) : 1

/** The pane's rows as drawn: the root box's rows, counted the way the engine stacks them. */
async function paneRows(ui: any): Promise<number> {
  return rowsOf((await ui.findAll({ type: 'Box' }))[0] as El)
}

async function texts(ui: any): Promise<string[]> {
  return (await ui.findAll({ type: 'Text' })).map((t: El) => textOf(t))
}

/** Registers the agent spawn hook; must run before the session starts. */
function spawnIds(on: any) {
  let k = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `agent-${++k}` }))
}

/** Spawns `n` implementer agents, each left working. */
async function spawnAgents($: any, n: number) {
  for (let i = 0; i < n; i++) await $.agent.spawn({ prompt: 'p', description: `Task ${i}`, subagentType: 'cairn:implementer' })
}

describe('inline view fits seven rows', () => {
  test('worst case: repo-root fallback, paused, approval waiting, another plan, main and five agents: within 7 rows, merged line', async ($, on) => {
    spawnIds(on)
    world(on, {
      cwd: MAIN,
      rows: [
        row(plan({ stage: 'prd', paused: { at: '2026-03-01T11:00:00.000Z', mode: 'drain' } }), WT, undefined, ready('prd')),
        row(plan({ slug: 'other', title: 'Other' }), OTHER),
      ],
    })
    await start($, MAIN)
    await spawnAgents($, 5)
    const ui = await mountAs($, { placement: 'inline' })
    expect(await paneRows(ui)).toBeLessThanOrEqual(7)
    const lines = await texts(ui)
    expect(lines).toContain('● +5 agents · +1 other plan')
    expect(lines.some(t => t.startsWith('Showing '))).toBe(false)
    expect(lines.some(t => /more agent/.test(t))).toBe(false)
    await ui.unmount()
  })

  test('with room, the Showing line stays and agent lines are drawn one each, no fold', async ($, on) => {
    spawnIds(on)
    world(on, { cwd: MAIN, rows: [row(plan({ stage: 'execute' }), WT)] })
    await start($, MAIN)
    await spawnAgents($, 1)
    const ui = await mountAs($, { placement: 'inline' })
    const lines = await texts(ui)
    expect(lines.some(t => t.startsWith('Showing '))).toBe(true)
    expect(lines.some(t => t.startsWith('● Main session'))).toBe(true)
    expect(lines.some(t => /more agent|other plan/.test(t))).toBe(false)
    expect(await paneRows(ui)).toBeLessThanOrEqual(7)
    await ui.unmount()
  })

  test('the Showing line goes first: with agents that would fold, it is dropped and every agent line is kept', async ($, on) => {
    spawnIds(on)
    world(on, { cwd: MAIN, rows: [row(plan({ stage: 'execute' }), WT)] })
    await start($, MAIN)
    await spawnAgents($, 2)
    const ui = await mountAs($, { placement: 'inline' })
    const lines = await texts(ui)
    expect(lines.some(t => t.startsWith('Showing '))).toBe(false)
    expect(lines.filter(t => /^● (Main session|Task \d)/.test(t)).length).toBe(3)
    expect(lines.some(t => /more agent/.test(t))).toBe(false)
    expect(await paneRows(ui)).toBeLessThanOrEqual(7)
    await ui.unmount()
  })

  test('with room for the other-plans line and one agent, both keep their own rows and nothing merges', async ($, on) => {
    spawnIds(on)
    world(on, { cwd: MAIN, rows: [row(plan({ stage: 'execute' }), WT), row(plan({ slug: 'other', title: 'Other' }), OTHER)] })
    await start($, MAIN)
    await spawnAgents($, 1)
    const ui = await mountAs($, { placement: 'inline' })
    const lines = await texts(ui)
    expect(lines).toContain('+1 other active plan')
    expect(lines.some(t => t.startsWith('● +'))).toBe(false)
    expect(await paneRows(ui)).toBeLessThanOrEqual(7)
    await ui.unmount()
  })

  test('agents fold into "+N more agents", counting agents only (the main line is not counted)', async ($, on) => {
    spawnIds(on)
    world(on, { rows: [row(plan({ stage: 'execute' }), WT)] })
    await start($, WT)
    await spawnAgents($, 4)
    const ui = await mountAs($, { placement: 'inline' })
    const lines = await texts(ui)
    expect(lines).toContain('● +3 more agents')
    expect(lines.some(t => t.startsWith('● Main session'))).toBe(true)
    expect(await paneRows(ui)).toBe(7)
    await ui.unmount()
  })
})
