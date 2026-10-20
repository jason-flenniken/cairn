// FR-03 and FR-04: the model may not approve, override, or edit plan state.
// Approvals and plan state come from the user (through the mod) and the CLI.
import type { EngineInterface, On } from 'claude-code'

const WHY = 'approvals and plan state come from the user and the CLI, not from tool calls.'
const REASON = `cairn: ${WHY}`

// Always denied, even for a read-only command: the secret, the grants, the proof variable.
const SECRET = /CAIRN_APPROVER|mod-secret|cairn\/grants/i
// Plan state or a file under <git common dir>/cairn/: denied unless the command only reads.
const GUARDED_FILE = /(?<![\w.-])state\.json(?!\w)|\.git\/cairn(\/|\b)|mod-heartbeat/i
const READ_ONLY = new Set(['cat', 'head', 'tail', 'grep', 'wc', 'less', 'jq'])
// A pseudo-terminal around cairn would fake the CLI's terminal proof (FR-01).
const PTY_WRAPPERS = new Set(['script', 'expect', 'unbuffer'])

/** The FR-03 verdict on a Bash command: `{ deny }` with the reason, or `{}`. */
export function bashVerdict(cmd: string): { deny?: string } {
  if (SECRET.test(cmd)) return { deny: REASON }
  if (/cairn/i.test(cmd) && segments(cmd).some(wrapsInPty)) return { deny: REASON }
  const isGuarded = GUARDED_FILE.test(cmd) || segments(cmd).some(approvesThroughCli)
  if (isGuarded && !isReadOnly(cmd)) return { deny: REASON }
  return {}
}

/** The simple commands of a command line, split at `;`, `&&`, `||`, `|`, `&`, newlines. */
function segments(cmd: string): string[] {
  return cmd.split(/&&|\|\||[;|&\n]/)
}

/** Words of one simple command, quotes dropped and `$(`, backticks, parens as breaks. */
function words(segment: string): string[] {
  return segment.replace(/["']/g, '').split(/[\s()`$]+/).filter(word => word !== '')
}

/** An `approve` word after `cairn`, `cairn.mjs`, `.../bin/cairn`, or a `dist/` path. */
function approvesThroughCli(segment: string): boolean {
  const list = words(segment)
  const cli = list.findIndex(word => {
    const base = word.slice(word.lastIndexOf('/') + 1)
    return base === 'cairn' || base === 'cairn.mjs' || word.includes('dist/')
  })
  return cli >= 0 && list.slice(cli + 1).includes('approve')
}

/** `script`, `expect`, `unbuffer`, or python/perl naming `pty`, as the command run. */
function wrapsInPty(segment: string): boolean {
  const [first = ''] = words(segment)
  return PTY_WRAPPERS.has(first) || (/^(python[\d.]*|perl)$/.test(first) && /pty/i.test(segment))
}

/** Every simple command is a listed reader, with no redirect, substitution, or `jq -i`. */
function isReadOnly(cmd: string): boolean {
  if (/[<>`]|\$\(/.test(cmd)) return false
  return segments(cmd)
    .map(words)
    .filter(list => list.length > 0)
    .every(([first, ...rest]) => {
      if (first === undefined || !READ_ONLY.has(first)) return false
      return first !== 'jq' || !rest.some(word => word === '-i' || word.startsWith('--in-place'))
    })
}

// A plan's state.json or STATUS.md, and the <git common dir>/cairn/ folder. Case-insensitive:
// on APFS a case alias keeps its own spelling in realPath.
const PLAN_FILE = /\/docs\/sdlc\/plans\/[^/]+\/(state\.json|status\.md)$/i
const CAIRN_DIR = /\/\.git\/cairn(\/|$)/i
const PATH_KEYS = ['file_path', 'path', 'notebook_path'] as const
// Tools that only read: they may read plan state, never the cairn folder (the secret).
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob'])

/** True for an absolute, resolved path a non-Bash tool may not write (FR-04). */
export function pathProtected(abs: string): boolean {
  return PLAN_FILE.test(abs) || CAIRN_DIR.test(abs)
}

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
    if (paths.length === 0) return next(e)
    const isRead = READ_TOOLS.has(String(e.tool))
    for (const path of paths) {
      const real = await landing($, path)
      if (real === undefined) return { deny: `cairn: cannot tell where ${path} lands, so the call is refused.` }
      if (isRead ? CAIRN_DIR.test(real) : pathProtected(real)) {
        return { deny: `cairn: ${path} is plan state or cairn's own folder; ${WHY}` }
      }
    }
    return next(e)
  }).catch(($, e, next) => {
    if (next.called || targetPaths(e).length === 0) return next(e)
    return { deny: 'cairn: its path guard failed, so the call is refused.' }
  })
}
