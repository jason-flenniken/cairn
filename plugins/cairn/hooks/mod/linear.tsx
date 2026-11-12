import type { CairnBoard } from '../../types/index.d.ts'
import type { Ui } from './header.tsx'

/** Model-written text reaches the terminal only without control characters (escapes, bell, CR, C1); newlines and tabs stay. */
export const stripControl = (s: string): string => s.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')

/**
 * Text written in Linear by other people: whole escape sequences go, then the rest of the control characters,
 * then the bidirectional marks and overrides that can reorder what is drawn.
 */
const clean = (s: string): string => stripControl(s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')).replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')

const WIDTH = 46
const BAR = 10

/** At most 3 keys, then `+N`. */
const keyList = (keys: string[]) => keys.slice(0, 3).map(clean).join(', ') + (keys.length > 3 ? ` +${keys.length - 3}` : '')
const cut = (s: string, n: number) => ([...s].length > n ? `${[...s].slice(0, Math.max(0, n - 1)).join('')}…` : s)
const bar = (done: number, total: number) => {
  const filled = total > 0 ? Math.round((done / total) * BAR) : 0
  return '█'.repeat(filled) + '░'.repeat(BAR - filled)
}

/**
 * The Linear tab's rows: the project and milestones, then what is in progress, ready and waiting, the done count and warnings.
 * Every indented row is a Box with paddingLeft so a wrapped row's second line keeps its indent.
 */
export function linearRows(ui: Ui, board: CairnBoard | null, note: string | null) {
  const { Box, Text } = ui
  if (board === null) {
    const hint = note !== null && !/no Linear project has been read yet/.test(note) ? clean(note) : 'No Linear project read yet. Run /cairn:board <project>.'
    return [<Text key="linear:none" dimColor wrap="wrap">{hint}</Text>]
  }
  const mins = board.ageMinutes
  const age = mins < 60 ? `${mins} min` : mins < 2880 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} days`
  const allDone = (m: CairnBoard['milestones'][number]) => m.counts.total > 0 && m.counts.done >= m.counts.total
  const focus = board.focus ?? board.milestones.find(m => !allDone(m))?.name ?? null
  const rows: unknown[] = []
  const indent = (key: string, node: unknown, pad = 2) => <Box key={key} paddingLeft={pad}>{node}</Box>

  rows.push(<Text key="linear:head" bold wrap="truncate-end">{clean(`${board.project} · read ${age} ago`)}</Text>)
  board.milestones.forEach((m, i) => {
    const key = `linear:m:${i}`
    if (allDone(m)) {
      rows.push(<Text key={key} color="green" wrap="truncate-end">{clean(`✓ ${m.name}`)}</Text>)
    } else if (m.name === focus) {
      const tail = ` ${bar(m.counts.done, m.counts.total)} ${m.counts.done}/${m.counts.total}`
      rows.push(<Text key={key} wrap="truncate-end"><Text bold>{cut(clean(m.name), WIDTH - [...tail].length)}</Text>{tail}</Text>)
    } else {
      const waits = m.waitsOn && m.waitsOn.length > 0 ? `  waits on ${keyList(m.waitsOn)}` : ''
      rows.push(<Text key={key} dimColor wrap="wrap">{clean(`${m.name}  ${m.counts.done}/${m.counts.total}`) + waits}</Text>)
    }
  })

  const running = board.inProgress ?? []
  if (running.length > 0) {
    rows.push(<Text key="linear:ip" bold wrap="truncate-end">▶ IN PROGRESS</Text>)
    running.forEach((p, pi) => {
      const rule = (key: string, node: unknown, pad = 0) => (
        <Box key={key} flexDirection="row"><Text color="cyan">┃ </Text><Box paddingLeft={pad} flexShrink={1}>{node}</Box></Box>
      )
      const k = `linear:ip:${pi}`
      rows.push(rule(`${k}:t`, <Text bold wrap="wrap">{clean(p.epic ? `${p.epic} ${p.title ?? p.slug}` : (p.title ?? p.slug))}</Text>))
      rows.push(rule(`${k}:s`, <Text dimColor wrap="wrap">{clean(`${p.slug} · ${p.stage} · ${p.done}/${p.total}`)}</Text>))
      p.issues.slice(0, 4).forEach(x => {
        const started = x.progress !== '' && !/not started/i.test(x.progress)
        rows.push(rule(`${k}:i:${x.key}`, <Text wrap="wrap">{clean(`${started ? '◐' : '·'} ${x.key} ${x.title}`)}</Text>, 2))
      })
      if (p.issues.length > 4) rows.push(rule(`${k}:more`, <Text dimColor>{`+${p.issues.length - 4} more`}</Text>, 2))
    })
  }

  // With every milestone done there is nothing to start, so the section is left out rather than saying nothing is ready.
  if (board.ready !== undefined && board.focus !== null) {
    if (board.ready.length === 0) rows.push(<Text key="linear:rd:none" wrap="wrap">○ Nothing ready: everything open waits on work in progress or blocked</Text>)
    else rows.push(<Text key="linear:rd" bold wrap="truncate-end">○ READY TO START</Text>)
    board.ready.forEach(r => {
      const where = r.milestone && r.milestone !== focus ? clean(r.milestone) : ''
      rows.push(indent(`linear:rd:${r.key}`, (
        <Text wrap="wrap">{clean(`${r.key} ${r.title}`)}{r.unblocks > 0 ? ` unblocks ${r.unblocks}` : ''}{where !== '' && <Text dimColor>{`  ${where}`}</Text>}</Text>
      )))
    })
  }

  const waiting = board.waiting ?? []
  if (waiting.length > 0) {
    rows.push(<Text key="linear:wt" dimColor wrap="truncate-end">· WAITING</Text>)
    waiting.forEach(w => {
      const count = w.kind === 'epic' && w.total !== undefined ? `  ${w.done ?? 0}/${w.total}` : ''
      const on = w.waitsOn.length > 0 ? `  on ${keyList(w.waitsOn)}` : '  waits on its own issues'
      rows.push(indent(`linear:wt:${w.key}`, <Text dimColor wrap="wrap">{clean(`${w.key} ${w.title}`) + count + on}</Text>))
    })
  }

  if (board.done !== undefined && board.done > 0) {
    rows.push(<Text key="linear:done" color="green" wrap="truncate-end">{`✓ DONE ${board.done} ${board.done === 1 ? 'issue' : 'issues'}`}</Text>)
  }
  const stalled = board.plans.filter(p => p.stalled)
  if (stalled.length > 0) {
    rows.push(<Text key="linear:stalled" color="yellow" wrap="wrap">{clean(`No change in over a week: ${stalled.map(p => `${p.slug} (${p.stage})`).join(', ')}`)}</Text>)
  }
  for (const l of board.wideLinks ?? []) {
    rows.push(<Text key={`linear:wide:${l.epic}:${l.on}`} color="yellow" wrap="wrap">{clean(`${l.epic}'s blocked-by link to ${l.on} makes all ${l.holds} of its open issues wait. Link only the sub-issues that need ${l.on}.`)}</Text>)
  }
  if (board.cycle !== null && board.cycle.length > 0) {
    rows.push(<Text key="linear:cycle" color="red" wrap="wrap">{clean(`Loop in blocked-by links: ${board.cycle.join(' → ')}. Remove one link in Linear.`)}</Text>)
  }
  return rows
}
