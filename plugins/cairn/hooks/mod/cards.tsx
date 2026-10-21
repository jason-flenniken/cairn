// The pane's agent cards and the main session's card (FR-01..FR-06), and the press helpers the
// other pane modules share. A press views that agent's conversation.
import type { EngineInterface } from 'claude-code'
import type { AgentCard } from '../../types/index.d.ts'
import { fmtDuration } from './activity.ts'
import { cells } from './bar.tsx'
import type { Ui } from './header.tsx'

export const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

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

const steps = (n: number) => `${n} step${n === 1 ? '' : 's'}`
const tokenCount = (n: number) => `${n >= 1000 ? `${Math.round(n / 1000)}k` : n} tokens`

/** What an agent has used: its tokens, and "~$0.42" beside them when the model has a price; empty before any are known. */
function usage(tokens: number | undefined, usd: number | undefined): string {
  if (tokens === undefined) return ''
  return usd === undefined ? tokenCount(tokens) : `${tokenCount(tokens)} ~$${usd.toFixed(2)}`
}

/** The docked pane's 48 columns less the pane's padding (2), the card's border (2) and its padding (2). */
const CARD_COLUMNS = 42

/** What every card draws with: the elements, the stage color, the time now, and the card's inner width. */
export type CardContext = { ui: Ui; accent: string; nowMs: number; columns?: number }

/** The main session's action while a turn runs; null while it waits for the person. */
export type Main = { action: string; since: number } | null

/** Cut to `columns` cells, with an ellipsis, then padded with spaces to exactly `columns`. */
function fit(text: string, columns: number): string {
  const isCut = cells(text) > columns
  let out = ''
  for (const ch of text) {
    if (cells(out + ch) > columns - (isCut ? 1 : 0)) break
    out += ch
  }
  if (isCut) out += '…'
  return out + ' '.repeat(Math.max(0, columns - cells(out)))
}

/** One line of a card; pressing it views the agent. A blank line keeps its row so every card is 3 lines. */
function cardLine($: EngineInterface, cx: CardContext, key: string, text: string, agentId: string | undefined, isDim: boolean) {
  const { Button, Text } = cx.ui
  // The press lands on the label's own cells, so the text is padded to the card's width: the whole row presses.
  return (
    <Button key={key} plain onPress={() => act($, () => viewPress($, agentId))}>
      <Text dimColor={isDim} wrap="truncate-end">{fit(text, cx.columns ?? CARD_COLUMNS)}</Text>
    </Button>
  )
}

/** One agent as a bordered card of 3 lines: title and model, status, activity; the main session is the same card. Every line is a full-width press. */
function card($: EngineInterface, cx: CardContext, key: string, border: string, title: string, model: string, status: string, activity: string, agentId?: string) {
  const { Box, Button, Text } = cx.ui
  const columns = cx.columns ?? CARD_COLUMNS
  const room = columns - cells(model) - (model === '' ? 0 : 1)
  return (
    <Box key={`${key}:card`} flexDirection="column" borderStyle="round" borderColor={border} paddingX={1}>
      <Button key={key} plain onPress={() => act($, () => viewPress($, agentId))}>
        <Text wrap="truncate-end">{fit(title, room)}</Text>
        {model !== '' && <Text dimColor>{` ${model}`}</Text>}
      </Button>
      {cardLine($, cx, `${key}:status`, status, agentId, false)}
      {cardLine($, cx, `${key}:activity`, activity, agentId, true)}
    </Box>
  )
}

export function agentCard($: EngineInterface, cx: CardContext, c: AgentCard) {
  const { accent, nowMs } = cx
  if (c.status === 'working') {
    // Steps lead the activity line: the status line holds the tokens and cost, and both must fit the card's width.
    const used = usage(c.tokensLive, c.usd)
    const status = `● working · ${fmtDuration(nowMs - c.startedAt)}${used === '' ? '' : ` · ${used}`}`
    return card($, cx, `agent:${c.agentId}`, accent, c.title, c.model, status, c.action === undefined ? steps(c.steps) : `${steps(c.steps)} · ${c.action}`, c.agentId)
  }
  const used = usage(c.tokens, c.usd)
  const took = fmtDuration(c.durationMs ?? 0)
  return card($, cx, `agent:${c.agentId}`, c.status === 'done' ? 'green' : 'red', c.title, c.model, `${c.status === 'done' ? '✓ finished' : '✗ stopped'} · ${took}${used === '' ? '' : ` · ${used}`}`, steps(c.steps), c.agentId)
}

export function mainCard($: EngineInterface, cx: CardContext, main: Main) {
  const { accent, nowMs } = cx
  return main === null
    ? card($, cx, 'main', 'gray', 'Main session', '', 'waiting for you', '')
    : card($, cx, 'main', accent, 'Main session', '', `● working · ${fmtDuration(nowMs - main.since)}`, main.action)
}

/**
 * One line per agent for the inline fit, where a card would not. With `max` rows to spend, the lines past
 * it fold into one "● +N more agents"; with no room at all, none are drawn.
 */
export function agentLines(cx: CardContext, main: Main, cards: AgentCard[], max = Infinity) {
  const { ui, nowMs } = cx
  const { Text } = ui
  const lines = [
    <Text key="main" wrap="truncate-end">{main === null ? '● Main session · waiting for you' : `● Main session · ${main.action} · ${fmtDuration(nowMs - main.since)}`}</Text>,
    ...cards.filter(c => c.status === 'working').map(c => <Text key={c.agentId} wrap="truncate-end">{`● ${c.title} · ${c.action ?? 'working'} · ${fmtDuration(nowMs - c.startedAt)}`}</Text>),
  ]
  if (lines.length <= max) return lines
  if (max < 1) return []
  const hidden = lines.length - (max - 1)
  return [...lines.slice(0, max - 1), <Text key="more" wrap="truncate-end">{`● +${hidden} more agent${hidden === 1 ? '' : 's'}`}</Text>]
}
