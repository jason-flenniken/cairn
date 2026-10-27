// The pane's agent cards and the main session's card (FR-01..FR-06), and the press helpers the
// other pane modules share. A press views that agent's conversation.
import type { EngineInterface } from 'claude-code'
import type { AgentCard } from '../../types/index.d.ts'
import { fmtDuration, type MainActivity } from './activity.ts'
import { cells } from './bar.tsx'
import { STAGE_LABEL, type Ui } from './header.tsx'

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

/**
 * What every card draws with: the elements, the stage color, the time now, the card's inner width, and the
 * shown plan's stage and task names, which place an agent in the process.
 */
export type CardContext = { ui: Ui; accent: string; nowMs: number; columns?: number; stage?: string; taskNames?: string[] }

/** What a role in an agent's "<Role> · <what>" description does; a review of a task or for security says which. */
const ROLE_STEP: Record<string, string> = { Build: 'building', Review: 'review', Fix: 'fixing', Check: 'checking', Record: 'writing the record' }

/**
 * Where an agent is in the process, from its description ("Review · Cart (security)", per reporting.md):
 * the title without the role, and the step with the plan's stage ("Build · security review"). Undefined
 * for a description that names no role, which keeps its title and reads "working".
 */
export function agentRole(title: string, stage?: string, taskNames: string[] = []): { title: string; step: string } | undefined {
  const m = /^(\w+) · (.+)$/.exec(title)
  const role = m?.[1]
  if (m === null || role === undefined || ROLE_STEP[role] === undefined) return undefined
  const isSecurity = / \(security\)$/.test(m[2] ?? '')
  const what = (m[2] ?? '').replace(/ \(security\)$/, '')
  const isTask = taskNames.includes(what)
  const step = role === 'Review' && isSecurity ? 'security review' : role === 'Review' && isTask ? 'task review' : (ROLE_STEP[role] as string)
  const where = stage === undefined ? undefined : STAGE_LABEL[stage]
  return { title: what.charAt(0).toUpperCase() + what.slice(1), step: where === undefined ? step : `${where} · ${step}` }
}

/** The first of the texts that fits `columns`; the last one when none does. */
const fitting = (columns: number, texts: string[]) => texts.find(x => cells(x) <= columns) ?? (texts.at(-1) as string)

/** The main session's action while a turn runs; null while it waits for the person. */
export type Main = MainActivity | null

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
  const role = agentRole(c.title, cx.stage, cx.taskNames)
  const title = role?.title ?? c.title
  if (c.status === 'working') {
    // Steps lead the activity line: the status line holds where the agent is, its time, tokens and cost; the cost,
    // then the tokens, give way before the card's width cuts the line.
    const lead = `● ${role?.step ?? 'working'} · ${fmtDuration(nowMs - c.startedAt)}`
    const tokens = usage(c.tokensLive, undefined)
    const used = usage(c.tokensLive, c.usd)
    const status = fitting(cx.columns ?? CARD_COLUMNS, [used === '' ? lead : `${lead} · ${used}`, tokens === '' ? lead : `${lead} · ${tokens}`, lead])
    return card($, cx, `agent:${c.agentId}`, accent, title, c.model, status, c.action === undefined ? steps(c.steps) : `${steps(c.steps)} · ${c.action}`, c.agentId)
  }
  const used = usage(c.tokens, c.usd)
  const took = fmtDuration(c.durationMs ?? 0)
  return card($, cx, `agent:${c.agentId}`, c.status === 'done' ? 'green' : 'red', title, c.model, `${c.status === 'done' ? '✓ finished' : '✗ stopped'} · ${took}${used === '' ? '' : ` · ${used}`}`, steps(c.steps), c.agentId)
}

/** "idle", with how many agents still work: the main session's turn ended but it is not asking you anything. */
function idle(cards: AgentCard[]): string {
  const n = cards.filter(c => c.status === 'working').length
  return n === 0 ? 'idle' : `idle · ${n} agent${n === 1 ? '' : 's'} working`
}

export function mainCard($: EngineInterface, cx: CardContext, main: Main, cards: AgentCard[]) {
  const { accent, nowMs } = cx
  if (main === null) return card($, cx, 'main', 'gray', 'Main session', '', idle(cards), '')
  if (main.isWaiting) return card($, cx, 'main', 'yellow', 'Main session', '', `● waiting for you · ${fmtDuration(nowMs - main.since)}`, 'answer in the chat')
  return card($, cx, 'main', accent, 'Main session', '', `● working · ${fmtDuration(nowMs - main.since)}`, main.action)
}

/**
 * One line per agent for the inline fit, where a card would not. With `max` rows to spend, the lines past
 * it fold into one "● +N more agents"; with no room at all, none are drawn.
 */
export function agentLines(cx: CardContext, main: Main, cards: AgentCard[], max = Infinity) {
  const { ui, nowMs } = cx
  const { Text } = ui
  const lines = [
    <Text key="main" wrap="truncate-end">{main === null ? `● Main session · ${idle(cards)}` : `● Main session · ${main.action} · ${fmtDuration(nowMs - main.since)}`}</Text>,
    ...cards.filter(c => c.status === 'working').map(c => {
      const role = agentRole(c.title, cx.stage, cx.taskNames)
      const doing = [role?.step, c.action ?? (role === undefined ? 'working' : undefined)].filter(Boolean).join(' · ')
      return <Text key={c.agentId} wrap="truncate-end">{`● ${role?.title ?? c.title} · ${doing} · ${fmtDuration(nowMs - c.startedAt)}`}</Text>
    }),
  ]
  if (lines.length <= max) return lines
  if (max < 1) return []
  const hidden = lines.length - (max - 1)
  return [...lines.slice(0, max - 1), <Text key="more" wrap="truncate-end">{`● +${hidden} more agent${hidden === 1 ? '' : 's'}`}</Text>]
}
