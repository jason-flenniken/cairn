// The pane's bottom bar (FR-01, FR-02, NFR-01): the plan's stage steps, wrapped to the bar's width,
// and the lines pane.tsx puts with them. pane.tsx pins it to the bottom of the pane's window.
import type { CairnPlanState } from '../../types/index.d.ts'
import { phaseAt, phasesOf, STAGE_COLOR, type Ui } from './header.tsx'
import { cells, lineCells } from './util.ts'

/** One styled run of a bar line; `fill` marks the spaces that push the rest to the right edge. */
export type BarSeg = { text: string; color?: string; bold?: boolean; dim?: boolean; fill?: boolean }
/** One bar line: its runs in order, drawn as one row. */
export type BarLine = BarSeg[]

/** The docked pane's 48 columns less a column of padding at each side. */
export const BAR_COLUMNS = 46
const GAP = '  '

const TRACKS: Record<string, [stage: string, label: string][]> = {
  feature: [
    ['discover', 'Disc'], ['prd', 'PRD'], ['plan', 'Plan'], ['execute', 'Build'],
    ['verify', 'Check'], ['review', 'Review'], ['ship', 'Ship'], ['learn', 'Learn'],
  ],
  fix: [['repro', 'Repro'], ['execute', 'Build'], ['review', 'Review'], ['ship', 'Ship']],
}

const PR_OPEN: BarSeg = { text: 'PR open', color: 'yellow' }

const trackOf = (state: CairnPlanState) => TRACKS[state.track ?? 'feature'] ?? TRACKS.feature!

/** One run per step of the plan's track: ✓ done, ● the active one (Build with its phase n/m), ○ upcoming. */
function steps(state: CairnPlanState): BarSeg[] {
  const track = trackOf(state)
  const isClosed = state.stage === 'closed'
  const at = track.findIndex(([stage]) => stage === state.stage)
  const phases = phasesOf(state).length
  return track.map(([stage, label], i) => {
    if (isClosed || i < at) return { text: `✓ ${label}`, color: 'success' }
    if (i > at) return { text: `○ ${label}`, dim: true }
    const phase = phaseAt(state)
    const count = stage === 'execute' && phases > 0 ? ` ${phase < 0 ? phases : phase + 1}/${phases}` : ''
    return { text: `● ${label}${count}`, bold: true, color: STAGE_COLOR[stage] }
  })
}

/** The stage-steps lines: every step of the plan's track in order, then PR open, wrapped between steps to fit `columns`. */
export function stageSteps(state: CairnPlanState, prOpen?: boolean, columns = BAR_COLUMNS): BarLine[] {
  const lines: BarLine[] = []
  for (const seg of [...steps(state), ...(prOpen === true ? [PR_OPEN] : [])]) {
    const line = lines[lines.length - 1]
    if (line !== undefined && lineCells(line) + cells(GAP) + cells(seg.text) <= columns) line.push({ text: GAP }, seg)
    else lines.push([seg])
  }
  return lines
}

/** The active step alone, for the inline pane's one bar line: Closed once the plan is, then PR open. */
export function activeStep(state: CairnPlanState, prOpen?: boolean): BarLine {
  const at = trackOf(state).findIndex(([stage]) => stage === state.stage)
  const step = state.stage === 'closed' ? { text: '✓ Closed', color: 'success' } : steps(state)[at]
  const line: BarLine = step === undefined ? [] : [step]
  return prOpen === true ? [...line, ...(line.length > 0 ? [{ text: GAP }] : []), PR_OPEN] : line
}

/**
 * The bar: one row per line. On a grid of cells (the terminal) each is padded with spaces to `columns` so a
 * pinned bar covers the content scrolled beneath it. Elsewhere spaces collapse and text is proportional, so a
 * `fill` run is a growing gap and an empty line is a blank row. With `top` it leaves the flow and sits that
 * many rows below its parent's top.
 */
export function Bar({ ui, lines, columns, top, isGrid = true }: { ui: Ui; lines: BarLine[]; columns: number; top?: number; isGrid?: boolean }) {
  const { Box, Text } = ui
  const place = top === undefined ? {} : ({ position: 'absolute', top, left: 0, right: 0, paddingX: 1 } as const)
  const run = (i: number, j: number, seg: BarSeg) => <Text key={`statusbar:${i}:${j}`} color={seg.color} bold={seg.bold} dimColor={seg.dim}>{seg.text}</Text>
  return (
    <Box key="statusbar" flexDirection="column" {...place}>
      {lines.map((line, i) => {
        if (isGrid) {
          return (
            <Text key={`statusbar:${i}`} wrap="truncate-end">
              {line.map((seg, j) => run(i, j, seg))}
              {' '.repeat(Math.max(0, columns - lineCells(line)))}
            </Text>
          )
        }
        const at = line.findIndex(seg => seg.fill === true)
        if (at < 0) return <Text key={`statusbar:${i}`} wrap="truncate-end">{line.length === 0 ? ' ' : line.map((seg, j) => run(i, j, seg))}</Text>
        return (
          <Box key={`statusbar:${i}`} flexDirection="row" justifyContent="space-between" gap={1}>
            <Text key="left" wrap="truncate-end">{line.slice(0, at).map((seg, j) => run(i, j, seg))}</Text>
            <Text key="right">{line.slice(at + 1).map((seg, j) => run(i, at + 1 + j, seg))}</Text>
          </Box>
        )
      })}
    </Box>
  )
}
