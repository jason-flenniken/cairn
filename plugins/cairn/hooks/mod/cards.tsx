// The pane's agent cards and the main session's card (FR-01..FR-06). A press views that agent's conversation.
import type { EngineInterface } from 'claude-code'
import type { AgentCard } from '../../types/index.d.ts'
import type { MainActivity } from './activity.ts'
import { STAGE_LABEL, type Ui } from './header.tsx'
import { act, cells, clean, fit, fitting, fmtClock, fmtDuration, tokenCount, viewPress } from './util.ts'

const steps = (n: number) => `${n} step${n === 1 ? '' : 's'}`

/** What an agent has used: its tokens, and "~$0.42" beside them when the model has a price; empty before any are known. */
function usage(tokens: number | undefined, usd: number | undefined): string {
  if (tokens === undefined) return ''
  return usd === undefined ? tokenCount(tokens) : `${tokenCount(tokens)} ~$${usd.toFixed(2)}`
}

/** The docked pane's 48 columns less the pane's padding (2): the width of every card line. */
const CARD_COLUMNS = 46

/** A card's border and status glyph take the status's color: running orange, completed green, failed red, waiting yellow, idle grey. */
export const STATUS_COLOR = { running: '#ff8700', completed: 'green', failed: 'red', waiting: 'yellow', idle: 'gray' } as const

/**
 * What every card draws with: the elements, the stage color, the time now, the card's width, and the
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

/** The main session's action while a turn runs; null while it waits for the person. */
export type Main = MainActivity | null

/** A run of a card line: its text, and the color or dimness it draws with. */
type Seg = { text: string; color?: string; isDim?: boolean }

/** Cut to `columns` cells with an ellipsis, not padded; empty when there is no room. */
const cut = (text: string, columns: number) => (columns <= 0 ? '' : fit(text, columns).trimEnd())

/** A label set in with a space either side, cut to leave `spare` cells; empty for no label or no room. */
function labelled(label: string, spare: number): string {
  const text = cut(label, spare - 2)
  return text === '' ? '' : ` ${text} `
}

/** The top border: `╭ 1 · Cart API ───╮`, the label at the left. */
function topBorder(label: string, columns: number): string {
  const text = labelled(label, columns - 3)
  return `╭${text}${'─'.repeat(Math.max(0, columns - 2 - cells(text)))}╮`
}

/** The bottom border: `╰──── 14 steps ───╯`, the label at the right. */
function bottomBorder(label: string, columns: number): string {
  const text = labelled(label, columns - 6)
  return `╰${'─'.repeat(Math.max(0, columns - 5 - cells(text)))}${text}───╯`
}

/** What a card row says: the step on the left, the status on the right (its first glyph in the status color); the left is cut first. */
function sides(left: string, right: string, inner: number, color: string): Seg[] {
  if (cells(right) + 1 > inner) return [{ text: fit(right, inner) }]
  const glyph = [...right][0] ?? ''
  const room = inner - cells(right) - 1
  return [{ text: (room > 0 ? fit(left, room) : '') + ' ' }, { text: glyph, color }, { text: right.slice(glyph.length) }]
}

/** One line of a card: a full-width press that views the agent. The press lands on the label's own cells, so the pieces fill the card. */
function line($: EngineInterface, cx: CardContext, key: string, segs: Seg[], agentId: string | undefined) {
  const { Button, Text } = cx.ui
  return (
    <Button key={key} plain onPress={() => act($, () => viewPress($, agentId))}>
      {segs.map((g, i) => <Text key={i} color={g.color} dimColor={g.isDim}>{g.text}</Text>)}
    </Button>
  )
}

/** What a card says on each row; `right` begins with its status glyph. */
export type CardRows = {
  number?: number
  title: string
  color: string
  left: string
  right: string
  line2: string
  line3: string
  line3Dim: boolean
  footer: string
}

/**
 * A card as five full-width presses in one column: a top border with the number and title, the step and
 * status, the model and usage, the action, and a bottom border with the footer. An engine border can't
 * hold text, so the frame is drawn as text; the border and the status glyph take `color`.
 */
export function cardRows($: EngineInterface, cx: CardContext, key: string, r: CardRows, agentId?: string) {
  const { Box } = cx.ui
  const columns = cx.columns ?? CARD_COLUMNS
  const inner = columns - 4
  const edge = (text: string): Seg => ({ text, color: r.color })
  const body = (segs: Seg[]): Seg[] => [edge('│ '), ...segs, edge(' │')]
  const top = topBorder(r.number === undefined ? r.title : `${r.number} · ${r.title}`, columns)
  const bottom = bottomBorder(r.footer, columns)
  return (
    <Box key={`${key}:card`} flexDirection="column">
      {line($, cx, key, [edge(top)], agentId)}
      {line($, cx, `${key}:status`, body(sides(r.left, r.right, inner, r.color)), agentId)}
      {line($, cx, `${key}:model`, body([{ text: fit(r.line2, inner), isDim: true }]), agentId)}
      {line($, cx, `${key}:activity`, body([{ text: fit(r.line3, inner), isDim: r.line3Dim }]), agentId)}
      {line($, cx, `${key}:end`, [edge(bottom)], agentId)}
    </Box>
  )
}

/** The model, then the tokens, then the cost; the cost, then the tokens, drop first, and no gap shows for an empty model. */
function modelRow(model: string, tokens: number | undefined, usd: number | undefined, inner: number): string {
  const join = (...parts: string[]) => parts.filter(p => p !== '').join(' · ')
  return fitting(inner, [join(model, usage(tokens, usd)), join(model, usage(tokens, undefined)), model])
}

export function agentCard($: EngineInterface, cx: CardContext, c: AgentCard) {
  const model = clean(c.model)
  const role = agentRole(clean(c.title), cx.stage, cx.taskNames)
  const title = role?.title ?? clean(c.title)
  const inner = (cx.columns ?? CARD_COLUMNS) - 4
  const key = `agent:${c.agentId}`
  const base = { number: c.number, title, left: role?.step ?? 'working', footer: steps(c.steps), line3Dim: true }
  if (c.status === 'working') {
    return cardRows($, cx, key, { ...base, color: STATUS_COLOR.running, right: `● running ${fmtClock(cx.nowMs - c.startedAt)}`, line2: modelRow(model, c.tokensLive, c.usd, inner), line3: c.call ?? c.lastCall ?? '', line3Dim: c.call === undefined }, c.agentId)
  }
  const isDone = c.status === 'done'
  const right = `${isDone ? '✓ completed' : '✗ failed'} ${fmtClock(c.durationMs ?? 0)}`
  return cardRows($, cx, key, { ...base, color: isDone ? STATUS_COLOR.completed : STATUS_COLOR.failed, right, line2: modelRow(model, c.tokens, c.usd, inner), line3: c.call ?? c.lastCall ?? '' }, c.agentId)
}

/** "idle", with how many agents still run: the main session's turn ended but it is not asking you anything. */
function idle(cards: AgentCard[]): string {
  const n = cards.filter(c => c.status === 'working').length
  return n === 0 ? 'idle' : `idle · ${n} agent${n === 1 ? '' : 's'} running`
}

/** The cards in draw order: running ones oldest first, then finished ones newest first (the Main card is drawn above both). */
export function orderCards(cards: AgentCard[]): AgentCard[] {
  const running = cards.filter(c => c.status === 'working').sort((a, b) => a.startedAt - b.startedAt)
  const ended = cards.filter(c => c.status !== 'working').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  return [...running, ...ended]
}

/** The Main card's bottom border: `2 running · 6 done` (and failed ones), counted from the cards shown; empty with none. */
function agentCounts(cards: AgentCard[]): string {
  const count = (status: AgentCard['status']) => cards.filter(c => c.status === status).length
  return [[count('working'), 'running'], [count('done'), 'done'], [count('failed'), 'failed']].filter(([n]) => n !== 0).map(([n, w]) => `${n} ${w}`).join(' · ')
}

/**
 * The Main card: working from the turn's start, waiting for you while a question of its is open (even with
 * agents running), idle from the turn's end. Row 3 is its tool call, or `answer in the chat` while waiting.
 */
export function mainCard($: EngineInterface, cx: CardContext, main: Main, cards: AgentCard[], idleSince = 0) {
  const { nowMs } = cx
  const base = { title: 'Main session', left: '', line2: '', footer: agentCounts(cards), line3Dim: true }
  if (main === null) return cardRows($, cx, 'main', { ...base, color: STATUS_COLOR.idle, right: idleSince > 0 ? `○ idle ${fmtClock(nowMs - idleSince)}` : '○ idle', line3: '' })
  if (main.isWaiting) return cardRows($, cx, 'main', { ...base, color: STATUS_COLOR.waiting, right: `◷ waiting for you ${fmtClock(nowMs - main.since)}`, line3: 'answer in the chat' })
  return cardRows($, cx, 'main', { ...base, color: STATUS_COLOR.running, right: `● working ${fmtClock(nowMs - (main.turnAt ?? main.since))}`, line3: main.call ?? clean(main.action), line3Dim: main.call === undefined })
}

/**
 * One line per agent for the inline fit, where a card would not. With `max` rows to spend, the lines past
 * it fold into one "● +N more agents"; with no room at all, none are drawn.
 */
export function agentLines(cx: CardContext, main: Main, cards: AgentCard[], max = Infinity) {
  const { ui, nowMs } = cx
  const { Text } = ui
  const lines = [
    <Text key="main" wrap="truncate-end">{main === null ? `● Main session · ${idle(cards)}` : `● Main session · ${clean(main.action)} · ${fmtDuration(nowMs - main.since)}`}</Text>,
    ...cards.filter(c => c.status === 'working').map(c => {
      const title = clean(c.title)
      const role = agentRole(title, cx.stage, cx.taskNames)
      const doing = [role?.step, c.action === undefined ? (role === undefined ? 'working' : undefined) : clean(c.action)].filter(Boolean).join(' · ')
      return <Text key={c.agentId} wrap="truncate-end">{`● ${role?.title ?? title} · ${doing} · ${fmtDuration(nowMs - c.startedAt)}`}</Text>
    }),
  ]
  if (lines.length <= max) return lines
  if (max < 1) return []
  // The main line is not an agent: the count is the agents the fold hides, whether or not the main line is kept.
  const shownAgents = Math.max(0, max - 2)
  const hidden = lines.length - 1 - shownAgents
  return [...lines.slice(0, max - 1), <Text key="more" wrap="truncate-end">{`● +${hidden} more agent${hidden === 1 ? '' : 's'}`}</Text>]
}

/**
 * The inline row that stands in for the agent lines and the other-plans line when there is no room for both:
 * "● +6 agents · +1 other plan". The agents part drops out with no working agent.
 */
export function foldedLine(cx: CardContext, cards: AgentCard[], plans: number) {
  const { ui } = cx
  const { Text } = ui
  const agents = cards.filter(c => c.status === 'working').length
  const parts = [agents > 0 && `+${agents} agent${agents === 1 ? '' : 's'}`, `+${plans} other plan${plans === 1 ? '' : 's'}`].filter(Boolean)
  return <Text key="folded" wrap="truncate-end">{`● ${parts.join(' · ')}`}</Text>
}
