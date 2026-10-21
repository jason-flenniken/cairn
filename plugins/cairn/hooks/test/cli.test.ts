import { expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import { cairn } from '../mod/cli.ts'

/** A `$` with only what cli.ts touches: the plugin root and a recorded process.run. */
function fake(stdout: string) {
  const runs: { argv: readonly string[]; init: unknown }[] = []
  const $ = {
    plugin: { name: 'cairn', root: '/plugins/cairn' },
    process: {
      run: async (argv: readonly string[], init?: unknown) => {
        runs.push({ argv, init })
        return { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
      },
    },
  } as unknown as EngineInterface
  return { $, runs }
}

test('cairn() runs <plugin root>/bin/cairn by argv, with cwd and env, and parses JSON', async () => {
  const { $, runs } = fake('{"stage":"execute"}\n')
  const got = await cairn($, ['status', '--json'], { cwd: '/wt', env: { CAIRN_APPROVER: 's' } })
  expect(runs).toEqual([
    { argv: ['/plugins/cairn/bin/cairn', 'status', '--json'], init: { cwd: '/wt', env: { CAIRN_APPROVER: 's' } } },
  ])
  expect(got).toEqual({ exitCode: 0, stdout: '{"stage":"execute"}\n', stderr: '', json: { stage: 'execute' } })
})

test('cairn() leaves json absent when stdout is not JSON', async () => {
  const { $ } = fake('plan x: execute\n')
  const got = await cairn($, ['status'])
  expect(got.json).toBeUndefined()
  expect(got.stdout).toBe('plan x: execute\n')
})
