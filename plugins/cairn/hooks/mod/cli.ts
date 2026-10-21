// The one way the mod runs the CLI: <plugin root>/bin/cairn by argv, never a shell.
import type { EngineInterface } from 'claude-code'
import type { CairnRun } from '../../types/index.d.ts'

export async function cairn(
  $: EngineInterface,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<CairnRun> {
  const { exitCode, stdout, stderr } = await $.process.run([`${$.plugin.root}/bin/cairn`, ...args], opts)
  return { exitCode, stdout, stderr, json: parseJson(stdout) }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
