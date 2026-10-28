import { describe, expect, test } from 'claude-code/testing'
import { toolCall } from '../mod/activity.ts'
import { clean } from '../mod/util.ts'
import { drawn, mount, plan, row, start, task, world, WT } from './world.tsx'

const EXECUTE = plan({
  phases: [{ id: 'p1', name: 'Core', status: 'in_progress', tasks: [task('cart', 'Cart', { status: 'in_progress' })] }],
})

/** The third row of agent-1's card, with whether its text is dimmed. */
async function thirdRow(ui: any): Promise<{ text: string; isDim: boolean }> {
  const b = (await ui.findAll({ type: 'Button' })).find((x: { key: string }) => x.key === 'agent:agent-1:activity')
  const text: string = b.label ?? b.text ?? ''
  const piece = (await ui.findAll({ type: 'Text' })).find((t: { text: string }) => t.text.trim() !== '' && t.text !== '│ ' && t.text !== ' │' && text.includes(t.text) && t.text.length < text.length && !/^[│ ]+$/.test(t.text))
  return { text: text.slice(2, -2).trimEnd(), isDim: piece?.props?.dimColor === true }
}

/**
 * The world, but with an fs.stat that resolves every path to itself: the path guard needs a real
 * file system under a Read or Edit, and the world's has no realPath, so it would refuse the call.
 */
function worldWithFiles(on: any) {
  const made = world(((name: string, ...rest: unknown[]) => (name === 'fs.stat' ? undefined : (on as any)(name, ...rest))) as never, { rows: [row(EXECUTE, WT)] })
  on('fs.stat', (_$: any, e: any) => ({ value: { kind: 'file', size: 1, mtimeMs: made.w.mtimes.get(e.path) ?? 0, isLink: false, realPath: e.path } as never }))
  return made
}

/** Every tool call stays open until `finish()`, as a running tool would. */
const open: (() => void)[] = []
const finish = () => open.splice(0).forEach(done => done())

async function setup($: any, on: any) {
  const { clock } = worldWithFiles(on)
  on('tool.call', () => new Promise<{ result: never }>(resolve => open.push(() => resolve({ result: 'ok' as never }))))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'agent-1' }))
  await start($, WT)
  const ui = await mount($, 'terminal')
  await $.agent.spawn({ prompt: 'p', description: 'Build · Cart', subagentType: 'cairn:implementer' })
  await $.turn.start({ text: 'p', turnId: 't1', agentId: 'agent-1' })
  await clock.advance(1_000)
  return { ui, clock }
}

const call = (input: Record<string, unknown>) => ({ ...input, agentId: 'agent-1' }) as never

describe('toolCall', () => {
  test('names the tool and its argument', () => {
    expect(toolCall({ tool: 'Read', file_path: '/repo/plugins/cairn/hooks/mod/cards.tsx' })).toBe('Read mod/cards.tsx')
    expect(toolCall({ tool: 'Edit', file_path: 'a.ts' })).toBe('Edit a.ts')
    expect(toolCall({ tool: 'NotebookEdit', notebook_path: '/x/y/n.ipynb' })).toBe('NotebookEdit y/n.ipynb')
    expect(toolCall({ tool: 'Glob', pattern: '**/*.test.ts' })).toBe('Glob **/*.test.ts')
    expect(toolCall({ tool: 'Grep', pattern: 'cache.get' })).toBe('Grep cache.get')
    expect(toolCall({ tool: 'Agent', description: 'Build · Checkout' })).toBe('Agent Build · Checkout')
    expect(toolCall({ tool: 'Bash', command: 'npm run build -- --watch' })).toBe('Bash npm run build')
    expect(toolCall({ tool: 'Bash', command: 'npm test' })).toBe('Bash npm test')
    expect(toolCall({ tool: 'Bash', command: 'git commit -m "x"' })).toBe('Bash git commit')
    expect(toolCall({ tool: 'Bash', command: 'FOO=1 node' })).toBe('Bash node')
  })

  test('an unknown tool, or a call with no argument, shows the name alone', () => {
    expect(toolCall({ tool: 'WebFetch', url: 'https://x' })).toBe('WebFetch')
    expect(toolCall({ tool: 'Read' })).toBe('Read')
    expect(toolCall({ tool: 'Bash', command: '' })).toBe('Bash')
    expect(toolCall({ tool: 'Grep', pattern: 5 })).toBe('Grep')
  })

  test('a Bash call shows the program and bare subcommand only, from the first command (FR-06)', () => {
    expect(toolCall({ tool: 'Bash', command: "curl -H 'Authorization: Bearer abc123' https://x" })).toBe('Bash curl')
    expect(toolCall({ tool: 'Bash', command: 'curl https://x' })).toBe('Bash curl')
    expect(toolCall({ tool: 'Bash', command: 'TOKEN=s3cret sudo /usr/bin/psql -c "select"' })).toBe('Bash psql')
    expect(toolCall({ tool: 'Bash', command: 'cd x && npm test' })).toBe('Bash cd')
    expect(toolCall({ tool: 'Bash', command: 'echo hunter2' })).toBe('Bash echo')
    expect(toolCall({ tool: 'Bash', command: 'ls | grep secret' })).toBe('Bash ls')
    expect(toolCall({ tool: 'Bash', command: 'git -C /secret/path commit' })).toBe('Bash git')
    expect(toolCall({ tool: 'Bash', command: 'git ./secret' })).toBe('Bash git')
    expect(toolCall({ tool: 'Bash', command: 'git a=b' })).toBe('Bash git')
    expect(toolCall({ tool: 'Bash', command: 'ls\nrm secret' })).toBe('Bash ls')
    expect(toolCall({ tool: 'Bash', command: 'true; npm test' })).toBe('Bash true')
  })

  test('a quoted assignment value, which may hold spaces, shows nothing of the command', () => {
    expect(toolCall({ tool: 'Bash', command: 'TOKEN="s3 cret psql" run' })).toBe('Bash')
    expect(toolCall({ tool: 'Bash', command: "TOKEN='a b' psql" })).toBe('Bash')
    expect(toolCall({ tool: 'Bash', command: '$(curl evil) x' })).toBe('Bash')
  })

  test('clean removes control characters, escape sequences and bidi overrides', () => {
    expect(clean('a\x1b[31mb\x1b[0m')).toBe('ab')
    expect(clean('a\x1b]0;title\x07b')).toBe('ab')
    expect(clean('a\u202ebc\u2066d\u200f\u0085\x07\x7f')).toBe('abcd')
    expect(clean('plain · text')).toBe('plain · text')
  })
})

describe('a card\'s third row', () => {
  test('a card before its first call has a blank third row and five lines', async ($, on) => {
    const { ui } = await setup($, on)
    const keys = (await ui.findAll({ type: 'Button' })).map((b: { key: string }) => b.key).filter((k: string) => k.startsWith('agent:agent-1'))
    expect(keys).toHaveLength(5)
    expect((await thirdRow(ui)).text).toBe('')
    await ui.unmount()
  })

  test('the call is full strength during it and dimmed once it completes', async ($, on) => {
    const { ui, clock } = await setup($, on)
    const running = $.tool.call(call({ tool: 'Grep', pattern: 'cache.get' }))
    await clock.advance(1_000)
    expect(await thirdRow(ui)).toEqual({ text: 'Grep cache.get', isDim: false })
    finish()
    await running
    await clock.advance(1_000)
    expect(await thirdRow(ui)).toEqual({ text: 'Grep cache.get', isDim: true })
    await ui.unmount()
  })

  test('a finished card keeps its last call, dimmed', async ($, on) => {
    const { ui, clock } = await setup($, on)
    const read = $.tool.call(call({ tool: 'Read', file_path: '/repo/src/cart.ts' }))
    await clock.advance(1_000)
    finish()
    await read
    await $.turn.complete({ turnId: 't1', agentId: 'agent-1', reason: 'answer', answer: 'x', durationMs: 5_000 } as never)
    await clock.advance(1_000)
    expect(await thirdRow(ui)).toEqual({ text: 'Read src/cart.ts', isDim: true })
    await ui.unmount()
  })

  test('an argument longer than the row is cut with an ellipsis and the line keeps the card width', async ($, on) => {
    const { ui, clock } = await setup($, on)
    const running = $.tool.call(call({ tool: 'Grep', pattern: 'y'.repeat(200) }))
    await clock.advance(1_000)
    const b = (await ui.findAll({ type: 'Button' })).find((x: { key: string }) => x.key === 'agent:agent-1:activity')
    const label: string = b.label ?? b.text
    expect([...label].length).toBe(58)
    expect(label).toContain('…')
    finish()
    await running
    await ui.unmount()
  })

  test('a Bash token never reaches the screen', async ($, on) => {
    const { ui, clock } = await setup($, on)
    const running = $.tool.call(call({ tool: 'Bash', command: "curl -H 'Authorization: Bearer abc123' https://x" }))
    await clock.advance(1_000)
    const text = await drawn(ui)
    expect(text).toContain('Bash curl')
    expect(text).not.toContain('abc123')
    expect(text).not.toContain('Bearer')
    finish()
    await running
    await ui.unmount()
  })

  test('escape sequences and bidi overrides in a path, description, title or model never reach the screen', async ($, on) => {
    const { clock } = worldWithFiles(on)
    on('tool.call', () => new Promise<{ result: never }>(resolve => open.push(() => resolve({ result: 'ok' as never }))))
    on('agent.spawn', () => ({ model: 'son\x1b[31mnet\u202e', agentId: 'agent-1' }))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.agent.spawn({ prompt: 'p', description: 'Build · Ca\u202ert\x07 \x1b[2J', subagentType: 'cairn:implementer' })
    await $.turn.start({ text: 'p', turnId: 't1', agentId: 'agent-1' })
    const read = $.tool.call(call({ tool: 'Read', file_path: 'a\x1b[31mb/c\u202ed.ts' }))
    await clock.advance(1_000)
    const text = await drawn(ui)
    expect(text).toContain('Read ab/cd.ts')
    expect(text).toContain('Cart')
    expect(text).toContain('sonnet')
    for (const bad of ['\x1b', '[31m', '[2J', '\u202e', '\x07']) expect(text).not.toContain(bad)
    finish()
    await read
    const agent = $.tool.call(call({ tool: 'Agent', description: 'Do \u202e\x07it' }))
    await clock.advance(1_000)
    const later = await drawn(ui)
    expect(later).toContain('Agent Do it')
    expect(later).not.toContain('\u202e')
    expect(later).not.toContain('\x07')
    finish()
    await agent
    await ui.unmount()
  })
})
