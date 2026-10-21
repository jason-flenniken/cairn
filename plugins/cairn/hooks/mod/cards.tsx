// The pane's agent cards and the main session's card (FR-01..FR-06), and the press helpers the
// other pane modules share. A press views that agent's conversation.
import type { EngineInterface } from 'claude-code'
import type { AgentCard } from '../../types/index.d.ts'
import { fmtDuration } from './activity.ts'
import type { Ui } from './header.tsx'

export const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** A press's work; a failure is a toast, never a throw (NFR-07). */
export function act($: EngineInterface, work: () => Promise<unknown>): void {
  void work().catch(err => $.ui.toast(`cairn: ${message(err)}`))
}

/** Puts an agent's conversation in the main view, or the main one for no id; a refusal is a toast. */
export async function viewPress($: EngineInterface, agentId?: string): Promise<void> {
  const shown = await $.ui.view(agentId === undefined ? {} : { agentId })
  if (shown.deny !== undefined) $.ui.toast(`cairn: ${shown.deny}`)
}

const steps = (n: number) => `${n} step${n === 1 ? '' : 's'}`

/** What every card draws with: the elements, the stage color, and the time now. */
export type CardContext = { ui: Ui; accent: string; nowMs: number }

/** The main session's action while a turn runs; null while it waits for the person. */
export type Main = { action: string; since: number } | null

/** One line of a card; pressing it views the agent. A blank line keeps its row so every card is 3 lines. */
function cardLine($: EngineInterface, ui: Ui, key: string, text: string, agentId: string | undefined, isDim: boolean) {
  const { Button, Text } = ui
  return (
    <Button key={key} plain onPress={() => act($, () => viewPress($, agentId))}>
      <Text dimColor={isDim} wrap="truncate-end">{text === '' ? ' ' : text}</Text>
    </Button>
  )
}

/** One agent as a bordered card of 3 lines: title and model, status, activity; the main session is the same card. */
function card($: EngineInterface, ui: Ui, key: string, border: string, title: string, model: string, status: string, activity: string, agentId?: string) {
  const { Box, Button, Text } = ui
  return (
    <Box key={`${key}:card`} flexDirection="column" borderStyle="round" borderColor={border} paddingX={1}>
      <Box key={`${key}:title`} flexDirection="row" justifyContent="space-between">
        <Box flexGrow={1} flexShrink={1}>
          <Button key={key} plain onPress={() => act($, () => viewPress($, agentId))}><Text wrap="truncate-end">{title}</Text></Button>
        </Box>
        <Text dimColor>{model}</Text>
      </Box>
      {cardLine($, ui, `${key}:status`, status, agentId, false)}
      {cardLine($, ui, `${key}:activity`, activity, agentId, true)}
    </Box>
  )
}

export function agentCard($: EngineInterface, cx: CardContext, c: AgentCard) {
  const { ui, accent, nowMs } = cx
  if (c.status === 'working') {
    return card($, ui, `agent:${c.agentId}`, accent, c.title, c.model, `● working · ${fmtDuration(nowMs - c.startedAt)} · ${steps(c.steps)}`, c.action ?? '', c.agentId)
  }
  const size = c.tokens === undefined ? '' : ` · ${c.tokens >= 1000 ? `${Math.round(c.tokens / 1000)}k` : c.tokens} tokens`
  const took = fmtDuration(c.durationMs ?? 0)
  return card($, ui, `agent:${c.agentId}`, c.status === 'done' ? 'green' : 'red', c.title, c.model, `${c.status === 'done' ? '✓ finished' : '✗ stopped'} · ${took}${size} · ${steps(c.steps)}`, '', c.agentId)
}

export function mainCard($: EngineInterface, cx: CardContext, main: Main) {
  const { ui, accent, nowMs } = cx
  return main === null
    ? card($, ui, 'main', 'gray', 'Main session', '', 'waiting for you', '')
    : card($, ui, 'main', accent, 'Main session', '', `● working · ${fmtDuration(nowMs - main.since)}`, main.action)
}

/** One line per agent for the inline fit, where a card would not. */
export function agentLines(cx: CardContext, main: Main, cards: AgentCard[]) {
  const { ui, nowMs } = cx
  const { Text } = ui
  return [
    <Text key="main" wrap="truncate-end">{main === null ? '● Main session · waiting for you' : `● Main session · ${main.action} · ${fmtDuration(nowMs - main.since)}`}</Text>,
    ...cards.filter(c => c.status === 'working').map(c => <Text key={c.agentId} wrap="truncate-end">{`● ${c.title} · ${c.action ?? 'working'} · ${fmtDuration(nowMs - c.startedAt)}`}</Text>),
  ]
}
