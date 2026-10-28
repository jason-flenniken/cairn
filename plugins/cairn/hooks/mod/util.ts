// The helpers the pane modules share: cell measuring and fitting, durations, the token count, and the
// press helpers. One module, so each has one definition.
import type { EngineInterface } from 'claude-code'
import type { BarLine } from './bar.tsx'

/** Terminal cells a text takes: an emoji shown as one takes 2, a joiner or variation selector none. */
export function cells(text: string): number {
  let n = 0
  for (const ch of text) {
    if (/[\u200d\ufe00-\ufe0f]|\p{Mn}/u.test(ch)) continue
    n += /\p{Emoji_Presentation}/u.test(ch) ? 2 : 1
  }
  return n
}

/** Terminal cells a line of runs takes. */
export const lineCells = (line: BarLine) => line.reduce((n, seg) => n + cells(seg.text), 0)

/** The first of the candidates that fits `columns`; the last one when none does. */
export function firstFit(candidates: BarLine[], columns: number): BarLine {
  return candidates.find(c => lineCells(c) <= columns) ?? candidates[candidates.length - 1]!
}

/** Cut to `columns` cells, with an ellipsis, then padded with spaces to exactly `columns`. */
export function fit(text: string, columns: number): string {
  const isCut = cells(text) > columns
  let out = ''
  for (const ch of text) {
    if (cells(out + ch) > columns - (isCut ? 1 : 0)) break
    out += ch
  }
  if (isCut) out += '…'
  return out + ' '.repeat(Math.max(0, columns - cells(out)))
}

/** The first of the texts that fits `columns`; the last one when none does. */
export const fitting = (columns: number, texts: string[]) => texts.find(x => cells(x) <= columns) ?? (texts.at(-1) as string)

/** 6m 12s, 45s, 1h 05m; coarse drops the seconds under an hour (12m). */
export function fmtDuration(ms: number, isCoarse = false): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (isCoarse) return `${Math.max(1, Math.round(total / 60))}m`
  return m > 0 ? `${m}m ${total % 60}s` : `${total}s`
}

/** 850 tokens, 41k tokens: the one token count the mod shows in full. */
export const tokenCount = (n: number) => `${n >= 1000 ? `${Math.round(n / 1000)}k` : n} tokens`

export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** A press's work; a failure is a toast, never a throw (NFR-07). */
export function act($: EngineInterface, work: () => Promise<unknown>): void {
  void work().catch(err => $.ui.toast(`cairn: ${message(err)}`))
}

/** Puts an agent's conversation in the main view, or the main one for no id; a refusal is a toast. */
export async function viewPress($: EngineInterface, agentId?: string): Promise<void> {
  const shown = await $.ui.view(agentId === undefined ? {} : { agentId })
  if (shown.deny === undefined) return
  $.ui.toast(agentId === undefined ? `cairn: ${shown.deny}` : `cairn: that agent's transcript isn't available (${shown.deny})`)
}
