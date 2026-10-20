// FR-06: while the mod runs, <git common dir>/cairn/mod-heartbeat holds the time of
// its last beat, as epoch milliseconds in plain text. The CLI reads it for modActive.
import type { EngineInterface, On, Timer } from 'claude-code'

const EVERY_MS = 2_000
// The running beat; a repeated session.start replaces it rather than stacking a second.
let ticking: Timer | undefined

/** The repository's git common dir, absolute; rejects outside a git repo. */
export async function commonDir($: EngineInterface): Promise<string> {
  const git = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (git.exitCode !== 0) throw new Error(`git rev-parse failed: ${git.stderr.trim()}`)
  return git.stdout.trim()
}

export function install(on: On): void {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const dir = await commonDir($).catch(() => undefined)
    if (dir === undefined) return started
    const file = `${dir}/cairn/mod-heartbeat`
    // An unwritable folder skips the beat; the CLI then reports modActive false (NFR-07).
    const beat = async () => {
      await $.fs.write(file, String(await $.clock.now())).catch(() => undefined)
    }
    await beat()
    ticking?.cancel()
    ticking = $.clock.every(EVERY_MS, () => void beat())
    return started
  })
}
