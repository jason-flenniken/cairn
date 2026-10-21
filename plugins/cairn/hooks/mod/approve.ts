// FR-02 menu approval and FR-34 mod-run overrides. The secret that proves the user to
// the CLI lives only here, in memory; only its SHA-256 is on disk, and each use spends it.
import type { EngineInterface, On, ProcessRunInit } from 'claude-code'
import type { CairnRun } from '../../types/index.d.ts'
import { cairn } from './cli.ts'
import { commonDir } from './heartbeat.ts'

export type Kind = 'prd' | 'plan' | 'ship'
export type Tag = { kind?: Kind; slug: string; question: string; override?: true }

const APPROVE_TAG = /\[cairn:approve (prd|plan|ship) ([^\s\]]+)\]/
const OVERRIDE_TAG = /\[cairn:override ([^\s\]]+)\]/
// How long a child may run: quick reads, and the commands that hold the secret.
const QUICK_MS = 60_000
const CLI_MS = 10 * 60_000

/** The cairn tags in a dialog's questions, each with the question text its answer is keyed by. */
export function parseTags(questions: readonly { question?: unknown }[]): Tag[] {
  const tags: Tag[] = []
  for (const { question } of questions) {
    if (typeof question !== 'string') continue
    const approve = APPROVE_TAG.exec(question)
    if (approve) tags.push({ kind: approve[1] as Kind, slug: approve[2] as string, question })
    const override = OVERRIDE_TAG.exec(question)
    if (override) tags.push({ slug: override[1] as string, question, override: true })
  }
  return tags
}

/** A label starting with "Approve", or free text that opens with an approving word. */
export function isApproveLabel(s: unknown): boolean {
  return typeof s === 'string' && (s.startsWith('Approve') || /^(approve|approved|lgtm|yes)\b/i.test(s))
}

type Asked = { question?: unknown; options?: readonly { label?: unknown }[]; multiSelect?: unknown }

/** A clicked option approves only when its label starts with "Approve" (the model wrote the labels); typed text by isApproveLabel; a multi-select never. */
export function isApproval(answer: unknown, asked: Asked | undefined): boolean {
  if (typeof answer !== 'string' || asked?.multiSelect === true) return false
  return (asked?.options ?? []).some(o => o.label === answer) ? answer.startsWith('Approve') : isApproveLabel(answer)
}

// The live secret, and the chain that serializes its uses: each use reads the secret
// current when its turn comes, then rotates it, so back-to-back uses never share one.
let secret: string | undefined
let uses: Promise<unknown> = Promise.resolve()

function hex(bytes: Uint8Array): string {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** A fresh secret in memory, its hash at <git common dir>/cairn/mod-secret.sha256 (0600). */
async function rotate($: EngineInterface): Promise<string> {
  const next = hex(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(next))
  const file = `${await commonDir($)}/cairn/mod-secret.sha256`
  await $.fs.write(file, hex(new Uint8Array(digest)))
  await $.process.run(['chmod', '600', file], { timeoutMs: QUICK_MS })
  secret = next
  return next
}

/** Runs `use` with the current secret, then rotates it whatever `use` did. */
function withSecret<T>($: EngineInterface, use: (secret: string) => Promise<T>): Promise<T> {
  const turn = uses.then(async () => {
    try {
      return await use(secret ?? (await rotate($)))
    } finally {
      // The used secret is gone either way; a failed write leaves the next use to make one.
      secret = undefined
      await rotate($).catch(() => undefined)
    }
  })
  uses = turn.catch(() => undefined)
  return turn
}

const quick: ProcessRunInit = { timeoutMs: QUICK_MS }

/** Runs bin/cairn with the secret in its env; the timeout keeps a hung CLI from holding the secret's turn. */
function cairnWithSecret($: EngineInterface, args: string[], cwd: string): Promise<CairnRun> {
  return withSecret($, s => {
    const init: ProcessRunInit = { cwd, env: { CAIRN_APPROVER: s }, timeoutMs: CLI_MS }
    return cairn($, args, init)
  })
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export type PlanState = { slug?: string; stage?: string; approvals?: Record<string, unknown> }
type PlanRow = { state?: PlanState; worktree?: string; ready?: { kind?: string } }

/** Every plan, from `cairn status --all --json` run where the session is. */
async function planRows($: EngineInterface): Promise<PlanRow[]> {
  return (await cairn($, ['status', '--all', '--json'], quick)).json?.plans ?? []
}

/** True when the CLI's status shows `kind` approved on plan `slug`. */
function isApproved(rows: PlanRow[], slug: string, kind: Kind): boolean {
  return Boolean(rows.find(p => p.state?.slug === slug)?.state?.approvals?.[kind])
}

/**
 * Approves `kind` on plan `slug` with the secret, or says why not: the one approval path, shared by
 * the menu answer, the pane's Approve button and /cairn-approve, so every use takes its turn with one secret.
 * Only a stop the CLI reports ready is approved. A stop already approved says nothing (undefined), so a second pass is silent.
 */
export async function approveAs($: EngineInterface, slug: string, kind: Kind): Promise<string | undefined> {
  const rows = await planRows($)
  const row = rows.find(p => p.state?.slug === slug)
  if (row?.state === undefined) return `cairn: no plan "${slug}", so nothing was approved.`
  if (row.worktree === undefined) return `cairn: plan "${slug}" is not checked out, so nothing was approved.`
  if (row.ready?.kind !== kind) {
    if (isApproved(rows, slug, kind)) return undefined
    return `cairn: plan "${slug}" is not waiting for ${kind} approval, so nothing was approved.`
  }
  const ran = await cairnWithSecret($, ['approve', kind], row.worktree).catch((err: unknown) => message(err))
  if (typeof ran === 'string') return `cairn: ${slug} ${kind} approval failed: ${ran}`
  const said = `${ran.stdout}${ran.stderr}`.trim()
  return ran.exitCode === 0 ? `cairn: ${slug}: ${said}` : `cairn: ${slug} ${kind} approval refused: ${said}`
}

export const ALREADY_APPROVED = 'Already approved from the pane'

// FR-34: plan slug -> when the user answered "Override". Memory only: no file stands for one.
const OVERRIDE_MS = 10 * 60_000
const pendingOverrides = new Map<string, number>()
const NOT_PLAIN =
  'it is not a plain cairn --override command (outside quotes: no ; | & $ ` > < newline or backslash, and no # * ? ~ ( ) { } [ ]; quotes closed)'

/**
 * A command's words, quotes joined as a shell joins them; undefined when a shell would read anything more into it.
 * Quoted text may hold any character: the mod runs the words as argv, never through a shell.
 */
function plainArgv(cmd: string): string[] | undefined {
  const words: string[] = []
  let word: string | undefined
  let quote = ''
  for (const c of cmd) {
    if (quote !== '') {
      if (c === quote) quote = ''
      else word += c
    } else if (c === '"' || c === "'") {
      quote = c
      word ??= ''
    } else if (/[;|&$`<>\n\r\\#*?~(){}[\]]/.test(c)) {
      return undefined
    } else if (/\s/.test(c)) {
      if (word !== undefined) words.push(word)
      word = undefined
    } else {
      word = (word ?? '') + c
    }
  }
  if (quote !== '') return undefined
  if (word !== undefined) words.push(word)
  return words
}

/** True when the argv carries `--override <reason>` or `--override=<reason>` with a reason. */
function hasOverride(argv: string[]): boolean {
  return argv.some((arg, i) => (arg === '--override' && (argv[i + 1] ?? '') !== '') || /^--override=./.test(arg))
}

/**
 * Runs a plain `cairn … --override` for the plan the user's Override named, spending it: the plan whose
 * worktree the session is in, or the one plan holding an override. `{}` when none is pending;
 * `{ why }` when the override can't be used.
 */
async function runOverride($: EngineInterface, argv: string[]): Promise<{ ran?: CairnRun | string; why?: string }> {
  const now = await $.clock.now()
  for (const [slug, at] of pendingOverrides) if (now - at > OVERRIDE_MS) pendingOverrides.delete(slug)
  if (pendingOverrides.size === 0) return {}
  const plans = await planRows($)
  const cwd = await $.session.cwd()
  const here = plans.find(p => p.worktree !== undefined && (cwd === p.worktree || cwd.startsWith(`${p.worktree}/`)))
  const slug = here?.state?.slug ?? (pendingOverrides.size === 1 ? [...pendingOverrides.keys()][0] : undefined)
  if (slug === undefined) {
    return { why: `overrides are pending for several plans (${[...pendingOverrides.keys()].join(', ')}), so run it from the plan's worktree` }
  }
  if (!pendingOverrides.has(slug)) return { why: `this session is in plan "${slug}", and your override is for another plan` }
  const worktree = plans.find(p => p.state?.slug === slug)?.worktree
  if (worktree === undefined) return { why: `plan "${slug}" is not checked out` }
  pendingOverrides.delete(slug)
  return { ran: await cairnWithSecret($, argv.slice(1), worktree).catch((err: unknown) => message(err)) }
}

export function install(on: On): void {
  // FR-34: with an Override pending, the mod runs the model's plain `cairn … --override` itself,
  // with the secret, in place of the shell. Everything else goes on as written.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const { command } = e
    if (pendingOverrides.size === 0 || e.agentId !== undefined || !/cairn/.test(command) || !/--override/.test(command)) {
      return next(e)
    }
    const argv = plainArgv(command)
    if (argv !== undefined && argv[0] !== 'cairn') return next(e)
    // `approve` never rides an override: approvals come from the menu (the Bash guard denies it too).
    const isPlain = argv !== undefined && !argv.includes('approve') && hasOverride(argv)
    const out = isPlain ? await runOverride($, argv) : { why: NOT_PLAIN }
    if (out.ran !== undefined) {
      // Core keeps no is_error from a hook's Bash result, so a failure reads as the Bash tool's does.
      const proof = 'cairn ran this --override itself, with your Override answer as proof'
      if (typeof out.ran === 'string') {
        return { result: { stdout: `cairn: the override run failed: ${out.ran}`, stderr: '', interrupted: false }, context: [`${proof}.`] }
      }
      const { stdout, stderr, exitCode } = out.ran
      const lead = exitCode === 0 ? '' : `Exit code ${exitCode}\n`
      const said = exitCode === 0 ? `${proof}.` : `${proof}; it failed with exit code ${exitCode}.`
      return { result: { stdout: `${lead}${stdout}`, stderr, interrupted: false }, context: [said] }
    }
    const ran = await next(e)
    if (out.why === undefined || ran.deny !== undefined) return ran
    return { ...ran, context: [...(ran.context ?? []), `cairn: the pending override was not used: ${out.why}.`] }
  })

  // No deny catch (NFR-02): a hook that fails is skipped, and the user's answer goes on as it was.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    // A malformed payload is not ours to read: it goes through untouched (FR-18).
    if (!Array.isArray(e.questions)) return next(e)
    // A question made only of approval tags whose stops the CLI already shows approved is answered here, not shown.
    // This reports an approval that exists; it records none. A subagent's, an untagged or a mixed dialog is left alone.
    if (e.agentId === undefined) {
      const asked = parseTags(e.questions)
      if (asked.length > 0 && asked.length === e.questions.length && asked.every(t => t.kind !== undefined)) {
        const rows = await planRows($).catch(() => undefined)
        if (rows !== undefined && asked.every(t => isApproved(rows, t.slug, t.kind as Kind))) {
          return { result: { questions: e.questions, answers: Object.fromEntries(asked.map(t => [t.question, ALREADY_APPROVED])) } as never }
        }
      }
    }
    // Answers the model wrote into its own call are not the user's: read them before the dialog runs.
    const prefilled = { ...(e as { answers?: Record<string, unknown> }).answers }
    const ran = await next(e)
    // A dismissed or failed dialog answered nothing; a subagent's is not the user's menu.
    if (ran.deny !== undefined || ran.isError || e.agentId !== undefined) return ran
    const tags = parseTags(e.questions)
    if (tags.length === 0) return ran
    const result = ran.result as { answers?: Record<string, unknown>; afkTimeoutMs?: number } | undefined
    const answers = result?.answers ?? {}
    const notes: string[] = []
    const judged = new Set<string>()
    for (const tag of tags) {
      if (tag.override) {
        if (answers[tag.question] === 'Override' && !(tag.question in prefilled) && result?.afkTimeoutMs === undefined) {
          pendingOverrides.set(tag.slug, await $.clock.now())
          notes.push(`cairn: your override for "${tag.slug}" is ready for 10 minutes: run the cairn --override command alone, with no cd or &&.`)
        }
        continue
      }
      if (tag.kind === undefined) continue
      // One stop is approved once per dialog, however many questions carry its tag (FR-15).
      if (judged.has(`${tag.kind} ${tag.slug}`)) continue
      const skipped = (why: string) => notes.push(`cairn: ${tag.slug} ${tag.kind} not approved: ${why}.`)
      if (tag.question in prefilled) skipped('the answer came from the model\'s call, not from you')
      else if (result?.afkTimeoutMs !== undefined) skipped('the dialog answered itself while you were away')
      else if (!isApproval(answers[tag.question], (e.questions as readonly Asked[]).find(q => q.question === tag.question))) {
        skipped('the answer was not "Approve"')
      }
      else {
        // Judged only once an approval is attempted, so a Revise on one tag does not block an Approve on another.
        judged.add(`${tag.kind} ${tag.slug}`)
        const outcome = await approveAs($, tag.slug, tag.kind)
        if (outcome === undefined) continue
        $.ui.toast(outcome)
        notes.push(outcome)
      }
    }
    return notes.length === 0 ? ran : { ...ran, context: [...(ran.context ?? []), ...notes] }
  })
}
