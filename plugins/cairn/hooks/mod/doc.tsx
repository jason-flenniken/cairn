// The doc viewer (FR-13..FR-15): the whole document in place of the tab's content, with its title, Back,
// and Approve while the document is waiting on approval. It only draws text; nothing in the text acts.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Ui } from './header.tsx'
import { message } from './util.ts'

export type Doc = { file: string; title: string; kind?: string }

// The document the viewer shows; null while closed.
const docOpen = atom({ plugin: 'cairn', key: 'docOpen' } as const, null as Doc | null)

/** The document the viewer shows, or null while it is closed. */
export async function readDoc($: EngineInterface): Promise<Doc | null> {
  return read($, docOpen)
}

/**
 * Scrolls the pane to its first line. The engine moves its window without asking the pane to draw, so a scroll
 * this mod makes is also what redraws the absolute bar at the window's last rows. A scroll the engine refuses
 * is no reason to fail the press. Callers fire it after their state update and do not wait on it.
 */
export async function scrollToStart($: EngineInterface, pane: string): Promise<void> {
  await $.ui.scroll({ in: pane, to: 'start' }).catch(() => undefined)
}

/** Opens the viewer at the document's first line. */
export async function openDoc($: EngineInterface, pane: string, doc: Doc): Promise<void> {
  await update($, docOpen, () => doc)
  void scrollToStart($, pane)
}

export async function closeDoc($: EngineInterface, pane: string): Promise<void> {
  await update($, docOpen, () => null)
  void scrollToStart($, pane)
}

/** The viewer's children: title, Back, Approve when `onApprove` is given, then the whole document. */
export async function docViewer($: EngineInterface, pane: string, ui: Ui, doc: Doc, onApprove: (() => void) | undefined, extra?: string) {
  const { Box, Button, Markdown, Text } = ui
  const text = await $.fs.read(doc.file).catch((err: unknown) => `Could not read ${doc.file}: ${message(err)}`)
  return [
    <Text key="doc:title" bold wrap="truncate-end">{doc.title}</Text>,
    <Box key="doc:buttons" flexDirection="row" gap={1}>
      <Button key="back" label="Back" onPress={() => void closeDoc($, pane).catch(err => $.ui.toast(`cairn: ${message(err)}`))} />
      {onApprove !== undefined && <Button key="approve" label="Approve" variant="primary" onPress={onApprove} />}
    </Box>,
    <Markdown key="document" text={text} />,
    extra !== undefined && <Markdown key="followups" text={extra} />,
  ]
}

