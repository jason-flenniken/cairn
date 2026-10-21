// The approval card (FR-11..FR-14): shown only while the CLI says the document is ready, with
// Read all and Approve, and the confirm every pane or /cairn-approve approval goes through (FR-05).
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { CairnReady } from '../../types/index.d.ts'
import { approveAs, type Kind } from './approve.ts'
import { act, message, viewPress } from './cards.tsx'
import type { Ui } from './header.tsx'

// The file whose full text the approval card shows below it (Read all); null while closed.
const readAllOf = atom({ plugin: 'cairn', key: 'readAllOf' } as const, null as string | null)

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

async function approvePress($: EngineInterface, slug: string, kind: Kind): Promise<void> {
  const said = await confirmAndApprove($, slug, kind)
  if (said !== undefined) $.ui.toast(said)
}

/** The card for the stop waiting on the person; inline, one row with Approve. Read all shows the document below it. */
export async function approvalCard($: EngineInterface, ui: Ui, slug: string, ready: CairnReady, isInline: boolean) {
  const { Box, Button, Markdown, Text } = ui
  const openFile = await read($, readAllOf)
  const isOpen = openFile === ready.file
  const docText = isOpen ? await $.fs.read(ready.file).catch((err: unknown) => `Could not read ${ready.file}: ${message(err)}`) : ''
  return (
    <Box key="waiting" flexDirection={isInline ? 'row' : 'column'} gap={1} borderStyle={isInline ? undefined : 'round'} borderColor="yellow" paddingX={isInline ? 0 : 1}>
      {isInline
        ? <Text bold color="yellow">{`Waiting on you: ${ready.kind} approval`}</Text>
        : <Button key="approval" plain onPress={() => act($, () => viewPress($))}><Text bold color="yellow">{`Waiting on you: ${ready.kind} approval`}</Text></Button>}
      {!isInline && <Markdown key="summary" text={ready.summary} />}
      <Box key="approval:buttons" flexDirection="row" gap={1}>
        {!isInline && (
          <Button key="readall" label={isOpen ? 'Close' : 'Read all'} onPress={() => act($, () => update($, readAllOf, cur => (cur === ready.file ? null : ready.file)))} />
        )}
        <Button key="approve" label="Approve" variant="primary" onPress={() => act($, () => approvePress($, slug, ready.kind))} />
      </Box>
      {isOpen && <Markdown key="document" text={docText} />}
    </Box>
  )
}
