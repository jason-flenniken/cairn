// FR-03 and FR-04: the model may not approve, override, or edit plan state.
// Approvals and plan state come from the user (through the mod) and the CLI.
// The Bash guard is a best-effort deny-list on spellings; the CLI's proof is the real control.
import type { EngineInterface, On } from 'claude-code'
import { after, before } from './activity.ts'
import { CAIRN_DIR, WHY, bashVerdict, pathProtected } from './guard-rules.ts'

export { bashVerdict, pathProtected }

const PATH_KEYS = ['file_path', 'path', 'notebook_path'] as const
// Tools that only read: they may read plan state, never the cairn folder (the secret).
// The searching ones may not start in a .git folder either, which holds the cairn folder.
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob'])
const SEARCH_TOOLS = new Set(['Grep', 'Glob'])
const GIT_DIR = /\/\.git(\/|$)/i

/** The paths a non-Bash tool call names; none means the path guard leaves it alone. */
function targetPaths(e: { tool: unknown }): string[] {
  if (e.tool === 'Bash') return []
  const input = e as unknown as Record<string, unknown>
  return PATH_KEYS.map(key => input[key]).filter((v): v is string => typeof v === 'string')
}

function isMissing(err: unknown): boolean {
  const { code, message } = (err ?? {}) as { code?: unknown; message?: unknown }
  return code === 'ENOENT' || /ENOENT/.test(String(message ?? err))
}

/**
 * Where a tool writing `path` lands: the deepest existing ancestor resolved by
 * `$.fs.stat` (symlinks and `..` folded), then the missing rest, since a Write
 * creates folders. Undefined when that can't be told; the guard then denies.
 */
async function landing($: EngineInterface, path: string): Promise<string | undefined> {
  if (path === '' || path.startsWith('~')) return undefined
  const parts = path.split('/')
  for (let cut = parts.length; cut >= 0; cut--) {
    const head = parts.slice(0, cut).join('/') || (path.startsWith('/') ? '/' : '.')
    const stat = await $.fs.stat(head, { resolve: true }).catch(err => {
      if (isMissing(err)) return undefined
      throw err
    })
    if (stat === undefined) continue
    const rest = parts.slice(cut).filter(part => part !== '' && part !== '.')
    if (stat.realPath === undefined || rest.includes('..')) return undefined
    return [stat.realPath.replace(/\/$/, ''), ...rest].join('/')
  }
  return undefined
}

export function install(on: On): void {
  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const { deny } = bashVerdict(e.command)
    return deny === undefined ? next(e) : { deny }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'cairn: its Bash guard failed, so the call is refused.' },
  )

  on('tool.call', async ($, e, next) => {
    const paths = targetPaths(e)
    const tool = String(e.tool)
    const isBlocked = (real: string) =>
      SEARCH_TOOLS.has(tool) ? GIT_DIR.test(real) : READ_TOOLS.has(tool) ? CAIRN_DIR.test(real) : pathProtected(real)
    for (const path of paths) {
      const real = await landing($, path)
      if (real === undefined) return { deny: `cairn: cannot tell where ${path} lands, so the call is refused.` }
      if (isBlocked(real)) {
        return { deny: `cairn: ${path} is plan state or cairn's own folder; ${WHY}` }
      }
    }
    // Allowed: the pane's card shows the call while it runs. The engine allows one unmatched tool.call hook per module.
    await before($, e)
    try {
      return await next(e)
    } finally {
      await after($, e)
    }
  }).catch(($, e, next) => {
    if (next.called || targetPaths(e).length === 0) return next(e)
    return { deny: 'cairn: its path guard failed, so the call is refused.' }
  })
}
