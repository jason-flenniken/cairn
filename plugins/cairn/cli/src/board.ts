import { effectiveBlockers, findIssueCycle, isDone, takenIssues, type BoardSnapshot, type IssueProgress } from './linear.ts';
import type { LinearIssue, State } from './types.ts';

export type BoardStatus = 'done' | 'in plan' | 'ready' | 'blocked';

export interface BoardIssue {
  key: string;
  title: string;
  milestone?: string;
  parent?: string;
  status: BoardStatus;
  plan?: { slug: string; stage: string; progress: IssueProgress };
  /** `where` is absent when the blocker sits in the same milestone and no plan. */
  blockedBy: { key: string; where?: string }[];
  /** Open issues waiting on this one, through chains: set on ready and in-plan issues. */
  unblocks?: number;
}

export interface BoardEpic {
  key: string;
  title: string;
  done: number;
  total: number;
  plans: string[];
  issues: BoardIssue[];
  state: 'active' | 'ready' | 'waiting' | 'done';
  waitsOn: string[];
  unblocks: number;
}

export interface BoardMilestone {
  name: string;
  counts: { total: number; done: number; inPlan: number; ready: number; blocked: number };
  epics: BoardEpic[];
  issues: BoardIssue[];
  waitsOn?: string[];
}

/** `cairn linear board --json` without `project`, `readAt` and the age fields, which `board()` adds. */
export interface BoardData {
  milestones: BoardMilestone[];
  plans: { slug: string; title?: string; stage: string; issues: string[]; stalled: boolean }[];
  cycle: string[] | null;
  readyEpics: string[];
  focus: string | null;
  inProgress: { slug: string; stage: string; epic?: string; title?: string; done: number; total: number; issues: { key: string; title: string; progress: IssueProgress }[] }[];
  ready: { key: string; title: string; kind: 'epic' | 'issue'; milestone: string; unblocks: number }[];
  waiting: { key: string; title: string; kind: 'epic' | 'issue'; done?: number; total?: number; waitsOn: string[] }[];
  done: number;
  wideLinks: { epic: string; on: string; holds: number }[];
}

export type BoardPlan = { slug: string; stage: string; state: State };

/** An epic's own link that holds this many open sub-issues is worth narrowing. */
const WIDE_LINK_HOLDS = 3;
const NO_MILESTONE = 'No milestone';

/** The plan that owns an issue: an open plan first, else a closed one that took it. */
export const ownerOf = (plans: BoardPlan[], k: string) =>
  plans.find((p) => (p.state.linear?.issues ?? []).some((i) => i.key === k && !i.released) && p.stage !== 'closed') ??
  plans.find((p) => (p.state.linear?.issues ?? []).some((i) => i.key === k && !i.released));

/** The board's sections, from a project snapshot and the plans that own its issues. Pure: no file or git access. */
export function buildBoard(input: { snap: BoardSnapshot; plans: BoardPlan[]; progress: Map<string, Map<string, IssueProgress>> }): BoardData {
  const { snap, plans, progress } = input;
  const byKey = new Map(snap.issues.map((i) => [i.key, i]));
  // Blockers from other projects are looked up, never counted.
  const lookup = new Map([...(snap.known ?? []), ...snap.issues].map((i) => [i.key, i]));
  const depends = plans.flatMap((p) => p.state.linear?.depends ?? []);
  const rank = new Map(snap.issues.map((i, n) => [i.key, n]));
  const linearOrder = (keys: Iterable<string>): string[] => {
    const xs = [...new Set(keys)];
    return xs.map((k, n) => ({ k, n })).sort((a, b) => (rank.get(a.k) ?? Infinity) - (rank.get(b.k) ?? Infinity) || a.n - b.n).map((x) => x.k);
  };
  const mile = (k: string) => byKey.get(k)?.milestone ?? '';

  const where = (i: LinearIssue, b: string): string | undefined => {
    const o = ownerOf(plans, b);
    if (o && o !== ownerOf(plans, i.key)) return `plan ${o.slug} (${o.stage})`;
    const x = byKey.get(b);
    if (!x) return 'another project';
    if ((x.milestone ?? '') === (i.milestone ?? '')) return undefined;
    return x.milestone ? `milestone ${x.milestone}` : 'this project';
  };
  const openBlockers = (i: LinearIssue) => linearOrder(effectiveBlockers(i, lookup, depends).filter((b) => !isDone(lookup.get(b))));
  const statusOf = (i: LinearIssue): BoardIssue => {
    const owner = ownerOf(plans, i.key);
    const blockers = openBlockers(i);
    const blockedBy = blockers.map((b) => {
      const w = where(i, b);
      return w ? { key: b, where: w } : { key: b };
    });
    const base = { key: i.key, title: i.title, ...(i.milestone ? { milestone: i.milestone } : {}), ...(i.parent ? { parent: i.parent } : {}), blockedBy };
    if (isDone(i)) return { ...base, status: 'done', blockedBy: [] };
    if (owner) return { ...base, status: 'in plan', plan: { slug: owner.slug, stage: owner.stage, progress: progress.get(owner.slug)?.get(i.key) ?? 'not started' } };
    return { ...base, status: blockers.length ? 'blocked' : 'ready' };
  };

  // Built from the epics' own positions, so every list of epics comes out in Linear order.
  const childOf = new Set(snap.issues.map((i) => i.parent).filter((p): p is string => !!p && byKey.has(p)));
  const parents = new Set(snap.issues.filter((i) => childOf.has(i.key)).map((i) => i.key));
  const leaves = snap.issues.filter((i) => !parents.has(i.key)).map(statusOf);
  const ancestors = (k: string): string[] => {
    const out: string[] = [];
    for (let p = byKey.get(k)?.parent; p && byKey.has(p) && !out.includes(p) && p !== k; p = byKey.get(p)?.parent) out.push(p);
    return out;
  };
  // Filtered from the flat lists, so a nested epic's issues keep their Linear positions.
  const descendants = (k: string): BoardIssue[] => leaves.filter((x) => ancestors(x.key).includes(k));
  const subtree = (k: string): string[] => [k, ...snap.issues.filter((i) => ancestors(i.key).includes(k)).map((i) => i.key)];

  // Who waits on whom: a blocker key (an issue or an epic) to the open issues that wait on it.
  const waitersOf = new Map<string, string[]>();
  for (const x of leaves) for (const b of x.blockedBy) waitersOf.set(b.key, [...(waitersOf.get(b.key) ?? []), x.key]);
  /** The open issues reached from these keys through blocked-by chains. A link to an epic waits on each of its sub-issues. */
  const reach = (start: string[]): Set<string> => {
    const seen = new Set<string>();
    const queue = [...start];
    const expanded = new Set<string>();
    while (queue.length) {
      const k = queue.shift()!;
      for (const via of [k, ...ancestors(k)]) {
        if (expanded.has(via)) continue;
        expanded.add(via);
        for (const w of waitersOf.get(via) ?? []) {
          if (seen.has(w)) continue;
          seen.add(w);
          queue.push(w);
        }
      }
    }
    return seen;
  };
  for (const x of leaves) {
    if (x.status !== 'ready' && x.status !== 'in plan') continue;
    const r = reach([x.key]);
    r.delete(x.key);
    x.unblocks = r.size;
  }

  const epicOf = (p: string): BoardEpic => {
    const kids = descendants(p);
    const inside = new Set(subtree(p));
    const open = kids.filter((k) => k.status !== 'done');
    const state: BoardEpic['state'] = kids.some((k) => k.status === 'in plan')
      ? 'active'
      : !open.length
        ? 'done'
        : open.every((k) => k.status === 'ready')
          ? 'ready'
          : 'waiting';
    const outside = [...reach([...inside])].filter((k) => !inside.has(k));
    return {
      key: p,
      title: byKey.get(p)!.title,
      done: kids.filter((k) => k.status === 'done').length,
      total: kids.length,
      plans: [...new Set(kids.map((k) => k.plan?.slug).filter((x): x is string => !!x))],
      issues: kids,
      state,
      waitsOn: linearOrder(open.flatMap((k) => k.blockedBy.map((b) => b.key)).filter((b) => !inside.has(b))),
      unblocks: outside.length,
    };
  };

  const count = (xs: BoardIssue[]) => ({ total: xs.length, done: xs.filter((x) => x.status === 'done').length, inPlan: xs.filter((x) => x.status === 'in plan').length, ready: xs.filter((x) => x.status === 'ready').length, blocked: xs.filter((x) => x.status === 'blocked').length });
  const named = [...new Set([...snap.milestones, ...snap.issues.map((i) => i.milestone ?? '')])].filter((n) => n);
  const names = [...named, ''];
  const topEpics = [...parents].filter((p) => !byKey.get(p)!.parent || !parents.has(byKey.get(p)!.parent!));
  const rows = names
    .map((name) => {
      const mine = leaves.filter((x) => (x.milestone ?? '') === name);
      const epics = topEpics.filter((p) => mile(p) === name).map(epicOf);
      const inEpic = new Set(epics.flatMap((e) => e.issues.map((i) => i.key)));
      // A sub-issue whose parent is outside the project is listed on its own.
      return { key: name, row: { name: name || NO_MILESTONE, counts: count(mine), epics, issues: mine.filter((x) => !inEpic.has(x.key) && !(x.parent && parents.has(x.parent))) } as BoardMilestone, mine };
    })
    .filter((m) => m.row.counts.total || m.row.epics.length);
  const focusRow = rows.find((m) => m.row.counts.done < m.row.counts.total);
  for (const m of rows) {
    if (m === focusRow) continue;
    const open = m.mine.filter((x) => x.status !== 'done');
    m.row.waitsOn = linearOrder(open.flatMap((x) => x.blockedBy.map((b) => b.key)).filter((b) => !byKey.has(b) || mile(b) !== m.key));
  }
  const milestones = rows.map((m) => m.row);
  const epics = milestones.flatMap((m) => m.epics);
  const milestoneOfRow = new Map(rows.flatMap((m) => [...m.row.epics.map((e) => [e.key, m.row.name] as const), ...m.mine.map((x) => [x.key, m.row.name] as const)]));

  const readyEpics = epics.filter((e) => e.state === 'ready');
  const inReadyEpic = new Set(readyEpics.flatMap((e) => e.issues.map((i) => i.key)));
  const byUnblocks = <T extends { key: string; unblocks: number }>(xs: T[]) => xs.map((x, n) => ({ x, n })).sort((a, b) => b.x.unblocks - a.x.unblocks || (rank.get(a.x.key) ?? Infinity) - (rank.get(b.x.key) ?? Infinity) || a.n - b.n).map((y) => y.x);
  const ready: BoardData['ready'] = [
    ...byUnblocks(readyEpics.map((e) => ({ key: e.key, title: e.title, kind: 'epic' as const, milestone: milestoneOfRow.get(e.key) ?? NO_MILESTONE, unblocks: e.unblocks }))),
    ...byUnblocks(leaves.filter((x) => x.status === 'ready' && !inReadyEpic.has(x.key)).map((x) => ({ key: x.key, title: x.title, kind: 'issue' as const, milestone: milestoneOfRow.get(x.key) ?? NO_MILESTONE, unblocks: x.unblocks ?? 0 }))),
  ];

  const waiting: BoardData['waiting'] = focusRow
    ? [
        ...focusRow.row.epics.filter((e) => e.state === 'waiting').map((e) => ({ key: e.key, title: e.title, kind: 'epic' as const, done: e.done, total: e.total, waitsOn: e.waitsOn })),
        ...focusRow.row.issues.filter((x) => x.status === 'blocked').map((x) => ({ key: x.key, title: x.title, kind: 'issue' as const, waitsOn: x.blockedBy.map((b) => b.key) })),
      ]
    : [];

  const onBoard = plans.filter((p) => p.stage !== 'closed' && !!p.state.linear && takenIssues(p.state.linear).some((i) => byKey.has(i.key)));
  const inProgress: BoardData['inProgress'] = onBoard.map((p) => {
    const l = p.state.linear!;
    const mine = takenIssues(l).filter((i) => byKey.has(i.key) && !parents.has(i.key));
    const epic = l.epic && byKey.get(l.epic);
    return {
      slug: p.slug,
      stage: p.stage,
      ...(l.epic ? { epic: l.epic } : {}),
      // The pane draws the epic's title when the plan builds one, else the plan's.
      title: epic ? epic.title : p.state.title,
      done: mine.filter((i) => isDone(byKey.get(i.key))).length,
      total: mine.length,
      issues: mine.map((i) => ({ key: i.key, title: byKey.get(i.key)!.title, progress: progress.get(p.slug)?.get(i.key) ?? 'not started' })),
    };
  });

  const wideLinks: BoardData['wideLinks'] = [];
  for (const p of parents) {
    const holds = descendants(p).filter((x) => x.status !== 'done').length;
    if (holds < WIDE_LINK_HOLDS) continue;
    for (const on of linearOrder(byKey.get(p)!.blockedBy)) if (on !== p && !isDone(lookup.get(on))) wideLinks.push({ epic: p, on, holds });
  }

  const week = 7 * 86_400_000;
  const planRows = onBoard.map((p) => ({ slug: p.slug, title: p.state.title, stage: p.stage, issues: takenIssues(p.state.linear!).map((i) => i.key), stalled: Date.now() - Date.parse(p.state.updated) > week }));

  return {
    milestones,
    plans: planRows,
    cycle: findIssueCycle(snap.issues, depends) ?? null,
    readyEpics: readyEpics.map((e) => e.key),
    focus: focusRow ? focusRow.row.name : null,
    inProgress,
    ready,
    waiting,
    done: leaves.filter((x) => x.status === 'done').length,
    wideLinks,
  };
}
