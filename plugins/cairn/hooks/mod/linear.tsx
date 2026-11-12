import type { CairnBoard, CairnBoardIssue } from '../../types/index.d.ts'
import type { Ui } from './header.tsx'

/** Model-written text reaches the terminal only without control characters (escapes, bell, CR, C1); newlines and tabs stay. */
export const stripControl = (s: string): string => s.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')

const MARKS = { done: '✓', 'in plan': '▸', ready: '○', blocked: '✗' } as const
const MARK_COLOR = { done: 'green', 'in plan': 'cyan', ready: undefined, blocked: 'red' } as const

/** The Linear tab's rows: header, then per milestone its counts, epics and issues, stalled plans and a loop warning. */
export function linearRows(ui: Ui, board: CairnBoard | null, note: string | null) {
  const { Box, Text } = ui
  if (board === null) {
    const hint = note !== null && !/no Linear project has been read yet/.test(note) ? stripControl(note) : 'No Linear project read yet. Run /cairn:board <project>.'
    return [<Text key="linear:none" dimColor wrap="wrap">{hint}</Text>]
  }
  const mins = board.ageMinutes
  const age = mins < 60 ? `${mins} min` : mins < 2880 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} days`
  const issue = (x: CairnBoardIssue, indent: string, id: string) => {
    const extra = x.status === 'in plan' && x.plan ? ` · ${x.plan.slug} (${x.plan.stage}, ${x.plan.progress})`
      : x.status === 'blocked' ? ` · blocked by ${x.blockedBy.map(b => `${b.key} [${b.where}]`).join(', ')}` : ''
    return <Text key={id} color={MARK_COLOR[x.status]} wrap="wrap">{stripControl(`${indent}${MARKS[x.status]} ${x.key} ${x.title}${extra}`)}</Text>
  }
  return [
    <Text key="linear:head" bold wrap="truncate-end">{stripControl(`${board.project} · read ${age} ago`)}</Text>,
    ...board.milestones.map((m, mi) => (
      <Box key={`linear:m:${mi}`} flexDirection="column">
        <Text bold wrap="wrap">{stripControl(`${m.name}: ${m.counts.done}/${m.counts.total} done · ${m.counts.inPlan} in plan · ${m.counts.ready} ready · ${m.counts.blocked} blocked`)}</Text>
        {m.epics.map(ep => (
          <Box key={`linear:e:${ep.key}`} flexDirection="column">
            <Text wrap="wrap">{stripControl(`  epic ${ep.key} ${ep.title}: ${ep.done}/${ep.total}${ep.plans.length > 0 ? ` · plans ${ep.plans.join(', ')}` : ''}`)}</Text>
            {ep.issues.map(x => issue(x, '    ', `linear:i:${ep.key}:${x.key}`))}
          </Box>
        ))}
        {m.issues.map(x => issue(x, '  ', `linear:i:${mi}:${x.key}`))}
      </Box>
    )),
    board.plans.some(p => p.stalled) && (
      <Text key="linear:stalled" color="yellow" wrap="wrap">{stripControl(`No change in over a week: ${board.plans.filter(p => p.stalled).map(p => `${p.slug} (${p.stage})`).join(', ')}`)}</Text>
    ),
    board.cycle !== null && board.cycle.length > 0 && (
      <Text key="linear:cycle" color="red" wrap="wrap">{stripControl(`Loop in blocked-by links: ${board.cycle.join(' → ')}. Remove one link in Linear.`)}</Text>
    ),
  ]
}
