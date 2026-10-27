// FR-03 and FR-04: the model may not approve, override, or edit plan state.
// Approvals and plan state come from the user (through the mod) and the CLI.
// The Bash guard is a best-effort deny-list on spellings; the CLI's proof is the real control.
import type { EngineInterface, On } from 'claude-code'
import { after, before } from './activity.ts'

const WHY = 'approvals and plan state come from the user and the CLI, not from tool calls.'
const REASON = `cairn: ${WHY}`
// Where to send the agent instead, so a denied approval is not followed by guessing at the CLI.
const ASK_REASON = `${REASON} Ask the user: read modActive from cairn status --json. When it is true, ask with AskUserQuestion tagged [cairn:approve <kind> <slug>] (or [cairn:level <slug>]); the mod records the answer. When it is false, give them the full --human command to run in their own terminal.`

// Words run before the real command: `env FOO=1 cairn`, `timeout 5 cairn`.
const PREFIXES = new Set(['env', 'exec', 'command', 'nohup', 'nice', 'time', 'sudo', 'xargs', 'timeout'])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])
const RUNTIMES = new Set(['node', 'nodejs', 'bun', 'deno'])
const INTERPRETERS = /^(python[\d.]*|node|nodejs|bun|deno|perl|ruby|php|osascript)$/
const DECLARERS = new Set(['export', 'declare', 'typeset', 'readonly', 'local', 'read'])
// A pseudo-terminal around cairn would fake the CLI's terminal proof (FR-01).
const PTY_WRAPPERS = new Set(['script', 'expect', 'unbuffer', 'tmux', 'screen'])
// Readers that only print or save their input, never run it.
const DATA_READERS = new Set(['cat', 'tee'])
const RECURSIVE_READERS = new Set(['rg', 'ag', 'ack', 'find', 'tar', 'zip', 'rsync', 'rgrep'])
const CAIRN_DIR_WORD = /(^|\/)\.git\/cairn(\/|$)/i
const HEARTBEAT_WORD = /(^|\/)\.git\/cairn\/mod-heartbeat$/i

/**
 * A simple command: its words (quotes removed) with where each sits in the line, its redirect
 * targets, the heredoc and here-string bodies fed to it, where in the line the bodies of its
 * quoted heredocs (`<<'EOF'`, which the shell never expands) sit, and whether it pipes into the next one.
 */
type Command = { words: string[]; spans: [number, number][]; redirects: string[]; bodies: string[]; inert: [number, number][]; pipesOut: boolean }

/** The FR-03 verdict on a Bash command: `{ deny }` with the reason, or `{}`. */
export function bashVerdict(cmd: string): { deny?: string } {
  if (!isDenied(cmd)) return {}
  return { deny: commands(cmd).some(c => approves(c) || changesLevel(c)) ? ASK_REASON : REASON }
}

function isDenied(cmd: string): boolean {
  const list = commands(cmd)
  // Command substitutions run too, inside double quotes as well. Single-quoted prose runs nothing.
  const code = withoutInertProse(cmd, list)
  for (const [, dollar, backtick] of code.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) {
    if (isDenied(dollar ?? backtick ?? '')) return true
  }
  if (/(\$\(|`)[^)`]*--(git-common-dir|git-dir|absolute-git-dir)/.test(code)) return true
  const mentionsCairn = /cairn/i.test(cmd)
  return list.some((command, at) =>
    readsDeniedInput(list, at) ||
    approves(command) ||
    changesLevel(command) ||
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
 * removed from words; `>`, `>>`, `&>` take the next word as a redirect target. A heredoc's
 * body (read from the lines after the one it starts on) and a here-string's word are bodies
 * of the command they feed.
 */
function commands(cmd: string): Command[] {
  const out: Command[] = []
  let words: string[] = []
  let spans: [number, number][] = []
  let redirects: string[] = []
  let bodies: string[] = []
  let inert: [number, number][] = []
  let word = ''
  let wordAt = 0
  let hasWord = false
  // A delimiter with any quoting (`'EOF'`, `"EOF"`, `\EOF`) leaves its body unexpanded.
  let isQuoted = false
  let quote = ''
  // What the word being read is: an argument, a redirect target, a heredoc delimiter, or a here-string.
  let role: 'word' | 'redirect' | 'delimiter' | 'string' = 'word'
  let isIndented = false
  let waiting: { delimiter: string; isIndented: boolean; isQuoted: boolean; bodies: string[]; inert: [number, number][] }[] = []
  const endWord = (at: number) => {
    if (hasWord) {
      if (role === 'redirect') redirects.push(word)
      else if (role === 'string') bodies.push(word)
      else if (role === 'delimiter') waiting.push({ delimiter: word, isIndented, isQuoted, bodies, inert })
      else {
        words.push(word)
        spans.push([wordAt, at])
      }
      role = 'word'
    }
    word = ''
    hasWord = false
    isQuoted = false
  }
  const endCommand = (at: number, pipesOut = false) => {
    endWord(at)
    if (words.length > 0 || redirects.length > 0) out.push({ words, spans, redirects, bodies, inert, pipesOut })
    words = []
    spans = []
    redirects = []
    bodies = []
    inert = []
    role = 'word'
  }
  // The lines after a newline up to the heredoc's delimiter line; returns where the next line starts.
  const readBodies = (from: number): number => {
    let at = from
    for (const { delimiter, isIndented: strip, isQuoted: isLiteral, bodies: into, inert: literal } of waiting) {
      const lines: string[] = []
      const bodyAt = at
      let bodyEnd = at
      while (at <= cmd.length) {
        const end = cmd.indexOf('\n', at)
        const line = cmd.slice(at, end < 0 ? cmd.length : end)
        const lineEnd = end < 0 ? cmd.length : end
        at = end < 0 ? cmd.length + 1 : end + 1
        if ((strip ? line.replace(/^\t+/, '') : line) === delimiter) break
        lines.push(line)
        bodyEnd = lineEnd
      }
      into.push(lines.join('\n'))
      if (isLiteral) literal.push([bodyAt, bodyEnd])
    }
    waiting = []
    return at
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
      if (role === 'delimiter') isQuoted = true
      if (!hasWord) wordAt = i
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
      if (role === 'delimiter') isQuoted = true
      if (!hasWord) wordAt = i
      hasWord = true
    } else if (c === '>' || (c === '&' && next === '>')) {
      word = word.replace(/^\d+$/, '')
      if (word === '') hasWord = false
      endWord(i)
      while (cmd[i + 1] === '>' || cmd[i + 1] === '|' || (cmd[i + 1] === '&' && /\d|-/.test(cmd[i + 2] ?? ''))) i++
      role = 'redirect'
    } else if (c === '<') {
      endWord(i)
      if (next === '<' && cmd[i + 2] === '<') {
        role = 'string'
        i += 2
      } else if (next === '<') {
        isIndented = cmd[i + 2] === '-'
        role = 'delimiter'
        i += isIndented ? 2 : 1
      }
    } else if (/\s/.test(c) && c !== '\n') {
      endWord(i)
    } else if (c === ';' || c === '\n' || c === '|' || c === '&' || c === '(' || c === ')') {
      endCommand(i, c === '|' && next !== '|')
      if ((c === '&' || c === '|') && next === c) i++
      if (c === '\n' && waiting.length > 0) i = readBodies(i + 1) - 1
    } else {
      if (!hasWord) wordAt = i
      word += c
      hasWord = true
    }
  }
  endCommand(cmd.length)
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
function split({ words }: Pick<Command, 'words'>): [string, string[]] {
  const at = commandAt(words)
  return [base(words[at] ?? ''), words.slice(at + 1)]
}

/** Where cairn's own arguments start in the command's words (`cairn …`, `node …/cairn.mjs …`), or -1. */
function cairnArgsAt({ words }: Pick<Command, 'words'>): number {
  const at = commandAt(words)
  const name = base(words[at] ?? '')
  if (name === 'cairn' || name === 'cairn.mjs') return at + 1
  if (!RUNTIMES.has(name)) return -1
  const script = words.findIndex((word, i) => i > at && !word.startsWith('-'))
  return script >= 0 && base(words[script] as string) === 'cairn.mjs' ? script + 1 : -1
}

/** The indexes of words that are prose to cairn: everything after `decide`, and `--note`/`--why` values. */
function proseWords(command: Command): Set<number> {
  const prose = new Set<number>()
  const from = cairnArgsAt(command)
  if (from < 0) return prose
  let isDeciding = false
  let isFirstPositional = true
  for (let at = from; at < command.words.length; at++) {
    const word = command.words[at] as string
    if (isDeciding || /^--(note|why)=/.test(word)) prose.add(at)
    else if (/^--(note|why)$/.test(word)) prose.add(++at)
    else if (!word.startsWith('-')) {
      isDeciding = isFirstPositional && word === 'decide'
      isFirstPositional = false
    }
  }
  return prose
}

/**
 * The line with the backticks and `$` blanked where a shell expands nothing: single-quoted parts
 * of prose words, and quoted heredoc bodies. Double-quoted and bare prose is expanded, so it is
 * still scanned. A quoted heredoc's body is still judged as input by whoever reads it (readsDeniedInput).
 */
function withoutInertProse(cmd: string, list: Command[]): string {
  // UTF-16 units, the same units the spans count in.
  const chars = cmd.split('')
  for (const command of list) {
    for (const [from, to] of command.inert) {
      for (let i = from; i < to; i++) if (chars[i] === '`' || chars[i] === '$') chars[i] = ' '
    }
    for (const at of proseWords(command)) {
      const [from, to] = command.spans[at] ?? [0, 0]
      let quote = ''
      for (let i = from; i < to; i++) {
        const c = chars[i]
        if (quote === "'") {
          if (c === "'") quote = ''
          else if (c === '`' || c === '$') chars[i] = ' '
        } else if (c === '\\') i++
        else if (quote === '"') {
          if (c === '"') quote = ''
        } else if (c === "'" || c === '"') quote = c
      }
    }
  }
  return chars.join('')
}

/** `approve` as an argument of cairn, `node …/cairn.mjs`, or a shell's `-c` script that does it. */
function approves(command: Command): boolean {
  const [name, args] = split(command)
  const from = cairnArgsAt(command)
  if (from >= 0) {
    const prose = proseWords(command)
    return command.words.some((word, at) => at >= from && word === 'approve' && !prose.has(at))
  }
  if (SHELLS.has(name) || name === 'eval') {
    const flag = args.findIndex(arg => /^-\w*c\w*$/.test(arg))
    const script = name === 'eval' ? args.join(' ') : args[flag + 1]
    return (name === 'eval' || flag >= 0) && script !== undefined && isDenied(script)
  }
  return false
}

/** `level` as an argument of cairn (parity with `approves`): level changes come from the user too. */
function changesLevel(command: Command): boolean {
  const from = cairnArgsAt(command)
  if (from < 0) return false
  const prose = proseWords(command)
  return command.words.some((word, at) => at >= from && word === 'level' && !prose.has(at))
}

/** `CAIRN_APPROVER=…` anywhere a shell reads an assignment, or `export`/`read` and kin naming it. */
function setsApprover({ words }: Command): boolean {
  const at = commandAt(words)
  if (words.slice(0, at + 1).some(word => /^CAIRN_APPROVER\+?=/.test(word))) return true
  const [name, args] = split({ words })
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

// Interpreter code that could change a file: a write call, a write-mode open, or a shell-out.
const WRITING_CODE = new RegExp(
  [
    'write', 'appendFile', 'json\\.dump\\b', '\\bdump\\s*\\(', 'truncate', 'unlink', 'rename', 'shutil',
    'os\\.(remove|replace|system|popen)', 'subprocess', 'Popen', 'exec(Sync|File)?\\b', 'spawn',
    `open\\w*\\s*\\([^)]*['"]([wax][bt+]*|r[bt]*\\+[bt]*)['"]`,
  ].join('|'),
  'i',
)

/** Interpreter code that names a state.json and could write it. Reading one is fine. */
const writesStateFile = (code: string): boolean => /state\.json/i.test(code) && WRITING_CODE.test(code)

/** Interpreter code given inline (`python -c`, `node -e`) that could write a state.json. */
function runsCodeNamingStateFile(command: Command): boolean {
  const [name, args] = split(command)
  return INTERPRETERS.test(name) && args.some(arg => /^-\w*[ce]$|^--eval$/.test(arg)) && writesStateFile(args.join(' '))
}

/**
 * What a command is fed on stdin, judged by who reads it. A heredoc body or here-string is code
 * for an interpreter (denied only if it could write a state.json), data for `cat` or `tee` that
 * pipe nowhere (they only print or save it), and shell for anything else. Text piped into a bare
 * shell is shell too.
 */
function readsDeniedInput(list: Command[], at: number): boolean {
  const command = list[at] as Command
  const reader = command.pipesOut && list[at + 1] !== undefined ? (list[at + 1] as Command) : command
  const [name, args] = split(reader)
  const isData = reader === command && DATA_READERS.has(name)
  if (command.bodies.length > 0 && !isData) {
    const isCode = INTERPRETERS.test(name)
    if (command.bodies.some(body => (isCode ? writesStateFile(body) : isDenied(body)))) return true
  }
  return reader !== command && SHELLS.has(name) && !args.includes('-c') && isDenied(split(command)[1].join(' '))
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

/** A path with a glob in or after a component that could be `.git`. A shell's `*` and `?` never match a leading dot. */
function globsIntoGit(word: string): boolean {
  const parts = word.split('/')
  const at = parts.findIndex(part => /^[.[]/.test(part) && globRegex(part).test('.git'))
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

// A plan's state.json or STATUS.md under docs/cairn/plans (current) or docs/sdlc/plans (legacy), and
// the <git common dir>/cairn/ folder. Case-insensitive: on APFS a case alias keeps its own spelling
// in realPath.
const PLAN_FILE = /\/docs\/(?:cairn|sdlc)\/plans\/[^/]+\/(state\.json|status\.md)$/i
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
