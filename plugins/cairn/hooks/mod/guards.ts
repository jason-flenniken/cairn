// FR-03 and FR-04: the model may not approve, override, or edit plan state.
// Approvals and plan state come from the user (through the mod) and the CLI.
// The Bash guard is a best-effort deny-list on spellings; the CLI's proof is the real control.
import type { EngineInterface, On } from 'claude-code'

const WHY = 'approvals and plan state come from the user and the CLI, not from tool calls.'
const REASON = `cairn: ${WHY}`

// Words run before the real command: `env FOO=1 cairn`, `timeout 5 cairn`.
const PREFIXES = new Set(['env', 'exec', 'command', 'nohup', 'nice', 'time', 'sudo', 'xargs', 'timeout'])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])
const RUNTIMES = new Set(['node', 'nodejs', 'bun', 'deno'])
const INTERPRETERS = /^(python[\d.]*|node|nodejs|bun|deno|perl|ruby|php|osascript)$/
const DECLARERS = new Set(['export', 'declare', 'typeset', 'readonly', 'local', 'read'])
// A pseudo-terminal around cairn would fake the CLI's terminal proof (FR-01).
const PTY_WRAPPERS = new Set(['script', 'expect', 'unbuffer', 'tmux', 'screen'])
const RECURSIVE_READERS = new Set(['rg', 'ag', 'ack', 'find', 'tar', 'zip', 'rsync', 'rgrep'])
const CAIRN_DIR_WORD = /(^|\/)\.git\/cairn(\/|$)/i
const HEARTBEAT_WORD = /(^|\/)\.git\/cairn\/mod-heartbeat$/i

/** A simple command: its words (quotes removed) and its redirect targets. */
type Command = { words: string[]; redirects: string[] }

/** The FR-03 verdict on a Bash command: `{ deny }` with the reason, or `{}`. */
export function bashVerdict(cmd: string): { deny?: string } {
  return isDenied(cmd) ? { deny: REASON } : {}
}

function isDenied(cmd: string): boolean {
  // Command substitutions run too, inside double quotes as well.
  for (const [, dollar, backtick] of cmd.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) {
    if (isDenied(dollar ?? backtick ?? '')) return true
  }
  if (/(\$\(|`)[^)`]*--(git-common-dir|git-dir|absolute-git-dir)/.test(cmd)) return true
  const mentionsCairn = /cairn/i.test(cmd)
  return commands(cmd).some(command =>
    approves(command) ||
    setsApprover(command) ||
    writes(command, isStateFile) ||
    runsCodeNamingStateFile(command) ||
    writes(command, word => HEARTBEAT_WORD.test(word)) ||
    reachesCairnFolder(command) ||
    (mentionsCairn && wrapsInPty(command)),
  )
}

/**
 * Splits a command line into simple commands, the way a shell would at unquoted
 * `;`, `&&`, `||`, `|`, `&`, newlines, and parentheses. Quotes and backslashes are
 * removed from words; `>`, `>>`, `&>` take the next word as a redirect target.
 */
function commands(cmd: string): Command[] {
  const out: Command[] = []
  let words: string[] = []
  let redirects: string[] = []
  let word = ''
  let hasWord = false
  let quote = ''
  let isRedirect = false
  const endWord = () => {
    if (hasWord) {
      ;(isRedirect ? redirects : words).push(word)
      isRedirect = false
    }
    word = ''
    hasWord = false
  }
  const endCommand = () => {
    endWord()
    if (words.length > 0 || redirects.length > 0) out.push({ words, redirects })
    words = []
    redirects = []
    isRedirect = false
  }
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i] as string
    const next = cmd[i + 1] ?? ''
    if (quote === "'") {
      if (c === "'") quote = ''
      else word += c
      continue
    }
    if (c === '\\' && next !== '') {
      word += next
      hasWord = true
      i++
      continue
    }
    if (quote === '"') {
      if (c === '"') quote = ''
      else word += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      hasWord = true
    } else if (c === '>' || (c === '&' && next === '>')) {
      word = word.replace(/^\d+$/, '')
      if (word === '') hasWord = false
      endWord()
      while (cmd[i + 1] === '>' || cmd[i + 1] === '|' || (cmd[i + 1] === '&' && /\d|-/.test(cmd[i + 2] ?? ''))) i++
      isRedirect = true
    } else if (c === '<') {
      endWord()
    } else if (/\s/.test(c) && c !== '\n') {
      endWord()
    } else if (c === ';' || c === '\n' || c === '|' || c === '&' || c === '(' || c === ')') {
      endCommand()
      if ((c === '&' || c === '|') && next === c) i++
    } else {
      word += c
      hasWord = true
    }
  }
  endCommand()
  return out
}

function base(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1)
}

/** Where the real command starts, past `env`, `VAR=x`, and prefixes' flags and counts. */
function commandAt(words: string[]): number {
  let isAfterPrefix = false
  for (let at = 0; at < words.length; at++) {
    const word = words[at] as string
    if (PREFIXES.has(base(word))) isAfterPrefix = true
    else if (/^\w+\+?=/.test(word)) continue
    else if (!(isAfterPrefix && /^-|^\d+[smhd]?$/.test(word))) return at
  }
  return words.length
}

/** The command's name and its arguments. */
function split({ words }: Command): [string, string[]] {
  const at = commandAt(words)
  return [base(words[at] ?? ''), words.slice(at + 1)]
}

/** `approve` as an argument of cairn, `node …/cairn.mjs`, or a shell's `-c` script that does it. */
function approves(command: Command): boolean {
  const [name, args] = split(command)
  if (name === 'cairn' || name === 'cairn.mjs') return args.includes('approve')
  if (RUNTIMES.has(name)) {
    const script = args.findIndex(arg => !arg.startsWith('-'))
    return base(args[script] ?? '') === 'cairn.mjs' && args.slice(script + 1).includes('approve')
  }
  if (SHELLS.has(name) || name === 'eval') {
    const flag = args.findIndex(arg => /^-\w*c\w*$/.test(arg))
    const script = name === 'eval' ? args.join(' ') : args[flag + 1]
    return (name === 'eval' || flag >= 0) && script !== undefined && isDenied(script)
  }
  return false
}

/** `CAIRN_APPROVER=…` anywhere a shell reads an assignment, or `export`/`read` and kin naming it. */
function setsApprover({ words }: Command): boolean {
  const at = commandAt(words)
  if (words.slice(0, at + 1).some(word => /^CAIRN_APPROVER\+?=/.test(word))) return true
  const [name, args] = split({ words, redirects: [] })
  if (!DECLARERS.has(name) && !(name === 'printf' && args.includes('-v'))) return false
  return args.some(arg => /^CAIRN_APPROVER(\+?=|$)/.test(arg))
}

function isStateFile(word: string): boolean {
  return base(word).toLowerCase() === 'state.json'
}

/** True when the command writes, moves, or deletes a file `isTarget` picks out. */
function writes(command: Command, isTarget: (word: string) => boolean): boolean {
  if (command.redirects.some(isTarget)) return true
  const [name, args] = split(command)
  const files = args.filter(arg => !arg.startsWith('-'))
  switch (name) {
    case 'sed':
    case 'gsed':
    case 'perl':
    case 'ruby':
      if (args.some(arg => /^-[a-zA-Z]*i/.test(arg) || arg.startsWith('--in-place'))) return files.some(isTarget)
      break
    case 'tee':
    case 'sponge':
    case 'rm':
    case 'unlink':
    case 'shred':
    case 'truncate':
    case 'touch':
    case 'mv':
      return files.some(isTarget)
    case 'cp':
    case 'ln':
    case 'install':
    case 'rsync':
      return isTarget(files.at(-1) ?? '')
    case 'dd':
      return args.some(arg => arg.startsWith('of=') && isTarget(arg.slice(3)))
    case 'git': {
      const sub = args.findIndex((arg, i) => !arg.startsWith('-') && args[i - 1] !== '-C')
      return ['checkout', 'restore', 'rm', 'mv'].includes(args[sub] ?? '') && args.slice(sub + 1).some(isTarget)
    }
  }
  return false
}

/** Interpreter code given inline (`python -c`, `node -e`) that names a state.json. */
function runsCodeNamingStateFile(command: Command): boolean {
  const [name, args] = split(command)
  return INTERPRETERS.test(name) && args.some(arg => /^-\w*[ce]$|^--eval$/.test(arg)) &&
    args.some(arg => /state\.json/i.test(arg))
}

/**
 * Anything under <git common dir>/cairn/ but the heartbeat file named exactly, a glob
 * that could reach into a `.git` folder, or a recursive read of a whole `.git` folder.
 */
function reachesCairnFolder(command: Command): boolean {
  const all = [...command.words, ...command.redirects]
  if (all.some(word => CAIRN_DIR_WORD.test(word) && !(HEARTBEAT_WORD.test(word) && !/[*?[]/.test(word)))) {
    return true
  }
  if (all.some(globsIntoGit)) return true
  const [name, args] = split(command)
  const isRecursive = RECURSIVE_READERS.has(name) ||
    (/^[ef]?grep$/.test(name) && args.some(arg => /^-\w*[rR]|^--recursive$/.test(arg))) ||
    (name === 'cp' && args.some(arg => /^-\w*[rRa]/.test(arg)))
  return isRecursive && args.some(arg => /(^|\/)\.git\/?$/i.test(arg))
}

/** A path with a glob in or after a component that could be `.git`. */
function globsIntoGit(word: string): boolean {
  const parts = word.split('/')
  const at = parts.findIndex(part => globRegex(part).test('.git'))
  return at >= 0 && at < parts.length - 1 && parts.slice(at).some(part => /[*?[]/.test(part))
}

function globRegex(glob: string): RegExp {
  const source = glob.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  try {
    return new RegExp(`^${source}$`, 'i')
  } catch {
    return /^\.git$/i
  }
}

/** A pty wrapper, or python/perl naming `pty`, as the command run. */
function wrapsInPty(command: Command): boolean {
  const [name] = split(command)
  return PTY_WRAPPERS.has(name) || (/^(python[\d.]*|perl)$/.test(name) && command.words.some(word => /pty/.test(word)))
}

// A plan's state.json or STATUS.md, and the <git common dir>/cairn/ folder. Case-insensitive:
// on APFS a case alias keeps its own spelling in realPath.
const PLAN_FILE = /\/docs\/sdlc\/plans\/[^/]+\/(state\.json|status\.md)$/i
const CAIRN_DIR = /\/\.git\/cairn(\/|$)/i
const PATH_KEYS = ['file_path', 'path', 'notebook_path'] as const
// Tools that only read: they may read plan state, never the cairn folder (the secret).
// The searching ones may not start in a .git folder either, which holds the cairn folder.
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob'])
const SEARCH_TOOLS = new Set(['Grep', 'Glob'])
const GIT_DIR = /\/\.git(\/|$)/i

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
    return next(e)
  }).catch(($, e, next) => {
    if (next.called || targetPaths(e).length === 0) return next(e)
    return { deny: 'cairn: its path guard failed, so the call is refused.' }
  })
}
