// The approval card (FR-11..FR-14): shown only while the CLI says the document is ready, with
// Read all and Approve, and the confirm every pane or /cairn-approve approval goes through (FR-05).
// Also the read-back card, shown while the read-back question is open in the chat.
import type { EngineInterface } from 'claude-code'
import type { CairnReadBack, CairnReady } from '../../types/index.d.ts'
import { answerReadBack, approveAs, isAskedInChat, isDialogOpen, LABEL_OF, levelAs, LEVEL_OF_LABEL, LEVELS, type Kind, type Level } from './approve.ts'
import { openDoc } from './doc.tsx'
import type { Ui } from './header.tsx'
import { act, viewPress } from './util.ts'

const DOC_NAME = { prd: 'PRD', plan: 'Plan', ship: 'Ship record' } as const

const APPROVE = 'Approve'
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const confirmQuestion = (kind: Kind, slug: string) => `Approve the ${kind} stop of plan ${slug}?`

/** Confirms with fixed wording, then approves through the shared secret path (FR-05). */
export async function confirmAndApprove($: EngineInterface, slug: string, kind: Kind): Promise<string | undefined> {
  // The slug is the only plan text in the question, and only when it is a plain slug: no tag can ride in.
  if (!SLUG.test(slug)) return 'cairn: the plan name is not a plain slug, so nothing was approved.'
  // $.ui.ask answers only a label, so a dialog that answered itself while the user was away can't be told
  // apart here. Cancel comes first, so a dialog that takes its first option approves nothing.
  const answer = await $.ui.ask(confirmQuestion(kind, slug), ['Cancel', APPROVE]).catch(() => undefined)
  if (answer !== APPROVE) return 'cairn: not approved; nothing was recorded.'
  return approveAs($, slug, kind)
}

/** The labels the CLI would accept as a target: not the level the plan is at, and none lower once a task has started. */
export function levelChoices(current: Level, hasStarted: boolean): string[] {
  const at = LEVELS.indexOf(current)
  return LEVELS.filter((l, i) => i !== at && !(hasStarted && i < at)).map(l => LABEL_OF[l])
}

/** Asks which level, with fixed wording, then sets it through the shared secret path. */
export async function confirmAndSetLevel($: EngineInterface, slug: string, current: Level, hasStarted: boolean): Promise<string> {
  // The slug is the only plan text in the question, and only when it is a plain slug: no tag can ride in.
  if (!SLUG.test(slug)) return 'cairn: the plan name is not a plain slug, so the level was not changed.'
  const choices = levelChoices(current, hasStarted)
  if (choices.length === 0) return `cairn: ${slug} is at ${LABEL_OF[current]} and nothing else can be chosen now; the level was not changed.`
  // Cancel comes first, so a dialog that takes its first option changes nothing.
  const answer = await $.ui.ask(`Change the depth level of plan ${slug}?`, ['Cancel', ...choices]).catch(() => undefined)
  const level = typeof answer === 'string' && choices.includes(answer) ? LEVEL_OF_LABEL[answer] : undefined
  if (level === undefined) return 'cairn: the level was not changed.'
  return levelAs($, slug, level)
}

/**
 * A pane Approve. A confirm is a dialog too, so while the agent's dialog is open it would wait behind it:
 * when that dialog asks for this same stop, the press is the answer and that dialog closes as approved;
 * any other open dialog has to be answered first.
 */
export async function approvePress($: EngineInterface, slug: string, kind: Kind): Promise<void> {
  const said = SLUG.test(slug) && isAskedInChat(kind, slug)
    ? await approveAs($, slug, kind)
    : isDialogOpen()
      ? 'cairn: answer the open question first; nothing was approved.'
      : await confirmAndApprove($, slug, kind)
  if (said !== undefined) $.ui.toast(said)
}

/** The card for the stop waiting on the person; inline, one row with Approve. Read all opens the doc viewer. */
export async function approvalCard($: EngineInterface, ui: Ui, slug: string, ready: CairnReady, isInline: boolean) {
  const { Box, Button, Markdown, Text } = ui
  return (
    <Box key="waiting" flexDirection={isInline ? 'row' : 'column'} gap={1} borderStyle={isInline ? undefined : 'round'} borderColor="yellow" paddingX={isInline ? 0 : 1}>
      {isInline
        ? <Text bold color="yellow">{`Waiting on you: ${ready.kind} approval`}</Text>
        : <Button key="approval" plain onPress={() => act($, () => viewPress($))}><Text bold color="yellow">{`Waiting on you: ${ready.kind} approval`}</Text></Button>}
      {!isInline && <Markdown key="summary" text={ready.summary} />}
      <Box key="approval:buttons" flexDirection="row" gap={1}>
        {!isInline && (
          <Button key="readall" label="Read all" onPress={() => act($, () => openDoc($, 'cairn', { file: ready.file, title: `${DOC_NAME[ready.kind]}: ${slug}`, kind: ready.kind }))} />
        )}
        <Button key="approve" label="Approve" variant="primary" onPress={() => act($, () => approvePress($, slug, ready.kind))} />
      </Box>
    </Box>
  )
}

/**
 * The read-back question open in the chat: the card and one button per option of the question, each answering
 * it with that label; inline, one row with the buttons.
 */
export function readBackCard(ui: Ui, rb: CairnReadBack, isInline: boolean) {
  const { Box, Button, Text } = ui
  const buttons = (
    <Box key="readback:buttons" flexDirection="row" gap={1}>
      {rb.options.map((label, i) => (
        <Button key={`readback:${i}`} label={label} variant={i === 0 ? 'primary' : undefined} onPress={() => answerReadBack(label)} />
      ))}
    </Box>
  )
  return (
    <Box key="readback" flexDirection={isInline ? 'row' : 'column'} gap={1} borderStyle={isInline ? undefined : 'round'} borderColor="yellow" paddingX={isInline ? 0 : 1}>
      <Text bold color="yellow">Waiting on you: read-back</Text>
      {!isInline && <Text key="card">{rb.card === '' ? 'The card is in the chat question.' : rb.card}</Text>}
      {buttons}
    </Box>
  )
}
