import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { bashVerdict, pathProtected } from '../mod/guards.ts'

const REASON = /approvals and plan state come from the user and the CLI/

describe('bashVerdict', () => {
  // FR-03 deny table, plus the spellings a model would try next.
  const denied = [
    'cairn approve prd',
    'node plugins/cairn/dist/cairn.mjs approve plan',
    'CAIRN_APPROVER=x cairn status',
    'export CAIRN_APPROVER=x',
    'cat mod-secret',
    'cat /repo/.git/cairn/mod-secret',
    'ls /repo/.git/cairn/grants',
    `python -c "import json; json.dump({}, open('docs/sdlc/plans/x/state.json', 'w'))"`,
    "sed -i '' 's/execute/ship/' docs/sdlc/plans/x/state.json",
    'git checkout -- docs/sdlc/plans/x/state.json',
    '"${CLAUDE_PLUGIN_ROOT}/bin/cairn" approve prd',
    'cd docs/sdlc/plans/x && sed -i s/a/b/ state.json',
    'echo $(cairn approve ship)',
    "bash -c 'cairn --json approve phase'",
    'cat docs/sdlc/plans/x/state.json > /tmp/copy',
    'cat docs/sdlc/plans/x/state.json; rm docs/sdlc/plans/x/state.json',
    // Anything written under <git common dir>/cairn/ is trusted by the CLI.
    'echo {} > /repo/.git/cairn/grants/x.json',
    'echo 99999999999999 > /repo/.git/cairn/mod-heartbeat',
    'touch "$(git rev-parse --git-common-dir)/cairn/mod-heartbeat"',
    // A pseudo-terminal around cairn would fake the terminal proof.
    'script -q /dev/null cairn status --human',
    `expect -c 'spawn cairn status; interact'`,
    'unbuffer cairn status',
    `python3 -c "import pty; pty.spawn(['cairn', 'status'])"`,
  ]
  for (const cmd of denied) {
    test(`denies: ${cmd}`, () => {
      expect(bashVerdict(cmd).deny).toMatch(REASON)
    })
  }

  // FR-03 allow table and Review focus 5: normal orchestrator commands.
  const allowed = [
    'cat docs/sdlc/plans/x/state.json',
    'jq .stage docs/sdlc/plans/x/state.json',
    'cat docs/sdlc/plans/x/state.json | jq .stage',
    'cairn status',
    'grep approve README.md',
    'git merge --no-ff sdlc-slice/cairn-v0-2/menu-approval',
    'git -C /repo/.claude/worktrees/sdlc-cairn-v0-2--approval-procedures diff sdlc/cairn-v0-2...HEAD',
    'npm test',
    'cairn ready --json',
    'cat bin/cairn | grep approve',
    'cat /repo/.git/cairn/mod-heartbeat',
    'npm run script',
  ]
  for (const cmd of allowed) {
    test(`allows: ${cmd}`, () => {
      expect(bashVerdict(cmd)).toEqual({})
    })
  }
})

describe('pathProtected', () => {
  const cases: [string, boolean][] = [
    ['/repo/docs/sdlc/plans/x/state.json', true],
    ['/repo/docs/sdlc/plans/x/STATUS.md', true],
    ['/repo/Docs/SDLC/plans/x/STATE.JSON', true],
    ['/repo/.git/cairn/mod-secret', true],
    ['/repo/.git/cairn/grants/x.json', true],
    ['/repo/.git/cairn', true],
    ['/repo/docs/sdlc/plans/x/plan.md', false],
    ['/repo/docs/sdlc/plans/x/sub/state.json', false],
    ['/repo/src/state.json', false],
    ['/repo/.git/config', false],
  ]
  for (const [abs, want] of cases) {
    test(`${abs} is ${want ? '' : 'not '}protected`, () => {
      expect(pathProtected(abs)).toBe(want)
    })
  }
})

// A file system beneath the plugin: paths that exist, and symlinks. `fs.stat`
// walks each component the way the OS does, so a missing folder rejects ENOENT
// (a `{ deny }` beneath the plugin is how the kit rejects a `$` call).
const DIRS = ['/', '/repo', '/repo/src', '/repo/docs', '/repo/docs/sdlc', '/repo/docs/sdlc/plans',
  '/repo/docs/sdlc/plans/x', '/repo/.git', '/repo/.git/cairn', '/repo/.git/cairn/grants', '/repo/Docs',
  '/repo/Docs/SDLC', '/repo/Docs/SDLC/plans', '/repo/Docs/SDLC/plans/x']
const FILES = ['/repo/docs/sdlc/plans/x/state.json', '/repo/docs/sdlc/plans/x/STATUS.md',
  '/repo/docs/sdlc/plans/x/plan.md', '/repo/.git/cairn/mod-secret', '/repo/Docs/SDLC/plans/x/STATE.JSON',
  '/repo/src/app.ts']
const LINKS: Record<string, string> = { '/repo/src/link.json': '/repo/docs/sdlc/plans/x/state.json' }

type Answer = { value: never } | { deny: string }

function fakeStat(path: string): Answer {
  const parts = (path.startsWith('/') ? path : `/repo/${path}`).split('/')
  let at: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') { at = at.slice(0, -1); continue }
    let next = `/${[...at, part].join('/')}`
    next = LINKS[next] ?? next
    if (!DIRS.includes(next) && !FILES.includes(next)) {
      return { deny: `ENOENT: no such file or directory, stat '${path}'` }
    }
    at = next.split('/').filter(p => p !== '')
  }
  const real = `/${at.join('/')}`
  const kind = FILES.includes(real) ? 'file' : 'dir'
  return { value: { kind, size: 0, mtimeMs: 0, isLink: path in LINKS, realPath: real } as never }
}

/** The engine beneath the plugin: a fake fs.stat and a tool that answers `ran`. */
function engine(on: On, stat: (path: string) => Answer = fakeStat) {
  on('fs.stat', (_$, e) => stat(e.path))
  on('tool.call', () => ({ result: 'ran' as never }))
}

const PROTECTED = /is plan state or cairn's own folder/
const FAILED = /guard failed/

describe('path guard (FR-04)', () => {
  const denied: [string, Record<string, string>][] = [
    ['Write', { file_path: '/repo/docs/sdlc/plans/x/state.json', content: '{}' }],
    ['Write', { file_path: '/repo/newdir/../docs/sdlc/plans/x/state.json', content: '{}' }],
    ['Write', { file_path: '/repo/src/link.json', content: '{}' }],
    ['Write', { file_path: '/repo/Docs/SDLC/plans/x/STATE.JSON', content: '{}' }],
    ['Write', { file_path: '/repo/docs/sdlc/plans/new-plan/state.json', content: '{}' }],
    ['Edit', { file_path: '/repo/docs/sdlc/plans/x/STATUS.md', old_string: 'a', new_string: 'b' }],
    ['Write', { file_path: '/repo/.git/cairn/grants/x.json', content: '{}' }],
    ['mcp__files__write_file', { path: '/repo/docs/sdlc/plans/x/state.json', content: '{}' }],
    ['NotebookEdit', { notebook_path: '/repo/docs/sdlc/plans/x/state.json', new_source: '' }],
    ['Read', { file_path: '/repo/.git/cairn/mod-secret' }],
  ]
  for (const [tool, input] of denied) {
    test(`denies ${tool} ${Object.values(input)[0]}`, async ($, on) => {
      engine(on)
      const got = await $.tool.call({ tool, ...input } as never)
      expect(got.deny).toMatch(PROTECTED)
    })
  }

  test('denies Write to a relative path with .. that resolves to state.json', async ($, on) => {
    // The engine makes a relative path absolute under the session's folder (here the
    // plugin's) and folds `..` before fs.stat; the fake maps that folder onto /repo.
    engine(on, path => fakeStat(path.replace(/^(?!\/repo).*?(?=\/docs(\/|$))/, '/repo')))
    const got = await $.tool.call({ tool: 'Write', file_path: 'docs/sdlc/plans/x/../x/state.json', content: '{}' })
    expect(got.deny).toMatch(PROTECTED)
  })

  test('denies a Write it cannot place (~ is the tool\'s to expand)', async ($, on) => {
    engine(on)
    const got = await $.tool.call({ tool: 'Write', file_path: '~/repo/docs/sdlc/plans/x/state.json', content: '{}' })
    expect(got.deny).toMatch(/cannot tell where/)
  })

  const allowed: [string, Record<string, string>][] = [
    ['Read', { file_path: '/repo/docs/sdlc/plans/x/state.json' }],
    ['Write', { file_path: '/repo/src/new-file.ts', content: 'x' }],
    ['Edit', { file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b' }],
    ['Write', { file_path: '/repo/docs/sdlc/plans/x/plan.md', content: 'x' }],
    ['Grep', { pattern: 'stage', path: '/repo/docs/sdlc/plans/x' }],
  ]
  for (const [tool, input] of allowed) {
    test(`allows ${tool} ${Object.values(input)[0]}`, async ($, on) => {
      engine(on)
      const got = await $.tool.call({ tool, ...input } as never)
      expect(got.deny).toBeUndefined()
      expect(got.result).toBe('ran')
    })
  }
})

describe('Bash guard (FR-03)', () => {
  test('denies cairn approve and lets cairn status run', async ($, on) => {
    engine(on)
    expect((await $.tool.call({ tool: 'Bash', command: 'cairn approve prd' })).deny).toMatch(REASON)
    expect((await $.tool.call({ tool: 'Bash', command: 'cairn status' })).result).toBe('ran')
  })
})

describe('guards fail closed (NFR-02)', () => {
  test('a throwing path guard denies the matched call and allows unmatched ones', async ($, on) => {
    engine(on, () => ({ deny: 'EIO: i/o error' }))
    const write = await $.tool.call({ tool: 'Write', file_path: '/repo/src/app.ts', content: 'x' })
    expect(write.deny).toMatch(FAILED)
    expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).result).toBe('ran')
    expect((await $.tool.call({ tool: 'TodoWrite', todos: [] } as never)).result).toBe('ran')
  })
})
