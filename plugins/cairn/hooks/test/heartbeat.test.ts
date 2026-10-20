import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const RAN = { stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

/** git answers the common dir (or fails), and fs.write is recorded. */
function engine(on: On, git: { exitCode: number; stdout: string }) {
  const writes: { path: string; text: string }[] = []
  const runs: (readonly string[])[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('process.run', (_$, e) => {
    runs.push(e.argv)
    return { value: { ...RAN, ...git } }
  })
  on('fs.write', (_$, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  return { writes, runs }
}

test('the heartbeat writes epoch ms to <git common dir>/cairn/mod-heartbeat every 2 s (FR-06)', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const { writes, runs } = engine(on, { exitCode: 0, stdout: '/repo/.git\n' })
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await clock.settle()
  expect(runs).toEqual([['git', 'rev-parse', '--path-format=absolute', '--git-common-dir']])
  expect(writes).toEqual([{ path: '/repo/.git/cairn/mod-heartbeat', text: '1000' }])

  await clock.advance(2_000)
  await clock.advance(2_000)
  expect(writes.map(w => w.text)).toEqual(['1000', '3000', '5000'])
})

test('outside a git repo the heartbeat is skipped and the session starts', async ($, on) => {
  const clock = mock.clock(on)
  const { writes } = engine(on, { exitCode: 128, stdout: '' })
  expect(await $.session.start({ cwd: '/tmp', surface: null, isInteractive: false })).toEqual({ cwd: '/tmp' })
  await clock.advance(4_000)
  expect(writes).toEqual([])
})

test('an unwritable common dir never fails the session', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({ value: { ...RAN, exitCode: 0, stdout: '/repo/.git\n' } }))
  on('fs.write', () => ({ deny: 'EACCES: permission denied' }))
  expect(await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })).toEqual({ cwd: '/repo' })
  await clock.advance(2_000)
})
