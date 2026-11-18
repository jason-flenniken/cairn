// Cold wake: the prompt cache lasts about an hour, so a message sent after a long idle re-sends the whole conversation
// at cache-write price. Everything cairn needs lives on disk, so when the session is idle, big, and on a plan it
// claimed, the mod clears it and runs /cairn:resume instead, then sends what the user typed. Also the one-time
// notice about what plugins and MCP servers add to every turn.
import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import type { CairnView } from '../../types/index.d.ts'
import { isClaimed } from './own.ts'

// Constants, no config keys.
export const IDLE_MS = 60 * 60_000
export const BIG_CONTEXT_TOKENS = 120_000
export const BASE_NOTICE_TOKENS = 60_000

// The pane's view atom (same key as pane.tsx's), read for the plan this session works on.
const view = atom({ plugin: 'cairn', key: 'view' } as const, null as CairnView | null)

export type Cold = { slug: string; idleMs: number; tokens: number }

// True from the first step of a fresh start until it has sent its last message; a second one never overlaps.
let starting = false
// The base-size notice is toasted once per session; the module's variables survive a /clear, $.store a reload.
let baseNoticed = false

/** Test hook: forgets the module's own state. */
export function resetColdWake(): void {
  starting = false
  baseNoticed = false
}

/** True while a cold-wake restart is under way: wake messages wait until it is done. */
export const isRestarting = (): boolean => starting

/** The key of the turn stamp. A /clear changes the session id, so an old session's stamp is never read. */
async function stampKey($: EngineInterface): Promise<string> {
  return `cairn:turn-stamp:${await $.session.id().catch(() => 'session')}`
}

/** The stamp text: `<epoch ms> <context tokens>`, both plain decimal, a space between. */
export const stampText = (at: number, tokens: number): string => `${Math.round(at)} ${Math.round(tokens)}`

/** Reads a stamp; undefined when it is missing or not two numbers. */
export function parseStamp(v: unknown): { at: number; tokens: number } | undefined {
  if (typeof v !== 'string') return undefined
  const m = /^(\d+) (\d+)$/.exec(v)
  return m === null ? undefined : { at: Number(m[1]), tokens: Number(m[2]) }
}

/** Called when a main turn completes: stamps its wall-clock time and the context size, and gives the base notice once. */
export async function stampTurn($: EngineInterface): Promise<void> {
  const key = await stampKey($)
  const at = await $.clock.now()
  const tokens = (await $.session.usage().catch(() => undefined))?.context.tokens
  // No reading counts as small: the turn is stamped, but nothing is cold.
  await $.store.set(key, stampText(at, tokens ?? 0)).catch(() => undefined)
  if (typeof tokens === 'number') await baseNotice($, tokens, key)
}

/** At the first measurement of a session: a big start-up context is toasted once. */
async function baseNotice($: EngineInterface, tokens: number, stamp: string): Promise<void> {
  if (baseNoticed) return
  const key = `${stamp}:base-notice`
  baseNoticed = true
  if ((await $.store.get(key).catch(() => undefined)) === 'yes') return
  await $.store.set(key, 'yes').catch(() => undefined)
  if (tokens > BASE_NOTICE_TOKENS) {
    $.ui.toast(
      `Your plugins and MCP servers add ~${Math.round(tokens / 1000)}K tokens to every turn. Turning off the ones this repo doesn't need (project .claude/settings.json) makes every cairn step cheaper.`,
    )
  }
}

/** The cold-wake rule: idle over an hour, over 120K tokens, and the session holds an open plan it claimed. */
export async function coldCheck($: EngineInterface): Promise<Cold | undefined> {
  const stamp = parseStamp(await $.store.get(await stampKey($)).catch(() => undefined))
  if (stamp === undefined) return undefined
  const idleMs = (await $.clock.now()) - stamp.at
  if (idleMs <= IDLE_MS || stamp.tokens <= BIG_CONTEXT_TOKENS) return undefined
  const v = await read($, view)
  const slug = v?.here
  const row = v?.plans.find(r => r.state.slug === slug)
  if (slug === undefined || row === undefined || row.state.stage === 'closed') return undefined
  if (!(await isClaimed($, slug))) return undefined
  return { slug, idleMs, tokens: stamp.tokens }
}

const hours = (ms: number): string => String(Math.round(ms / 360_000) / 10)

/**
 * Clears the conversation, runs /cairn:resume for the plan, then sends `followUp` (what the user typed, or a wake
 * message) as a prompt. Starts after the calling hook has answered, because a command run from inside a hook the
 * turn waits on is refused; until it has sent its last message, nothing else starts a second one.
 */
export function freshStart($: EngineInterface, cold: Cold, followUp: string | undefined): void {
  starting = true
  $.clock.after(0, () => void run($, cold, followUp))
}

async function run($: EngineInterface, cold: Cold, followUp: string | undefined): Promise<void> {
  try {
    await $.command.run({ command: 'clear' })
    $.ui.toast(`Idle ${hours(cold.idleMs)}h: started a fresh conversation from the plan's files instead of re-sending ${Math.round(cold.tokens / 1000)}K tokens.`)
    // Until the new conversation reports its first turn, nothing is cold.
    await $.store.set(await stampKey($), stampText(await $.clock.now(), 0)).catch(() => undefined)
    await $.command.run({ command: 'cairn:resume', args: cold.slug })
  } catch {
    // The restart failed part way: the message below still goes out, into whatever conversation there is.
  } finally {
    starting = false
  }
  if (followUp !== undefined) await $.prompt.submit({ text: followUp, asUser: true }).catch(() => undefined)
}

export function install(on: On): void {
  // A prompt the user typed after a long idle: dropped here, and sent again after the fresh start.
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || e.isMeta === true || (e.origin !== undefined && e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') || starting) return next(e)
    const cold = await coldCheck($).catch(() => undefined)
    if (cold === undefined) return next(e)
    freshStart($, cold, e.text)
    return { drop: 'cairn: starting a fresh conversation from the plan; your message goes in right after.' }
  })
}
