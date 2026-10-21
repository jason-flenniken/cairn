// FR-06: while the mod runs, <git common dir>/cairn/mod-heartbeat holds the time of
// its last beat, as epoch milliseconds in plain text. The CLI reads it for modActive.
import type { EngineInterface, SessionStartInput, Timer } from 'claude-code'

const EVERY_MS = 2_000
// The running beat; a repeated session.start replaces it rather than stacking a second.
let ticking: Timer | undefined

/** The repository's git common dir, absolute; rejects outside a git repo. */
export async function commonDir($: EngineInterface): Promise<string> {
  const git = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (git.exitCode !== 0) throw new Error(`git rev-parse failed: ${git.stderr.trim()}`)
  return git.stdout.trim()
}

/** Called by register.tsx's single session.start: writes the first beat and starts the timer. */
export async function onSessionStart($: EngineInterface, _e: SessionStartInput): Promise<void> {
  const dir = await commonDir($).catch(() => undefined)
  if (dir === undefined) return
  const file = `${dir}/cairn/mod-heartbeat`
  // An unwritable folder skips the beat; the CLI then reports modActive false (NFR-07).
  const beat = async () => {
    await $.fs.write(file, String(await $.clock.now())).catch(() => undefined)
  }
  await beat()
  ticking?.cancel()
  ticking = $.clock.every(EVERY_MS, () => void beat())
}
