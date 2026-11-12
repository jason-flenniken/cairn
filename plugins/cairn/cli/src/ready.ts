import { scopesOverlap } from './glob.ts';
import type { Phase, Task, State } from './types.ts';

export const currentPhase = (s: State): Phase | undefined => s.phases.find((p) => p.status !== 'done');
export const allTasks = (s: State): Task[] => s.phases.flatMap((p) => p.tasks);
export const findTask = (s: State, id: string): Task | undefined => allTasks(s).find((x) => x.id === id);

export interface ReadyResult {
  ready: Task[];
  inProgress: Task[];
  waiting: { task: Task; on: string[] }[];
  phase?: Phase;
}

/** Substeps that hold a builder. A task in review or merging does not. */
const HOLDS_BUILDER = new Set<string | undefined>([undefined, 'implementing', 'fixing', 'blocked']);

/**
 * Tasks that can start now: blockers done, scope disjoint from running work, under the cap.
 * Besides the current phase, the phases right after it that are marked `overlap` may start tasks whose own blockers
 * are done. Phases still finish in order.
 * The cap counts tasks that hold a builder: implementing, fixing, or blocked (a blocked task still holds its builder).
 * A task in review or merging does not.
 */
export function readySet(s: State, maxParallel: number): ReadyResult {
  const phase = currentPhase(s);
  const done = new Set(allTasks(s).filter((x) => x.status === 'done').map((x) => x.id));
  const inProgress = allTasks(s).filter((x) => x.status === 'in_progress');
  const result: ReadyResult = { ready: [], inProgress, waiting: [], phase };
  if (!phase || s.stage !== 'execute' || s.paused) return result;
  let room = Math.max(0, maxParallel - inProgress.filter((x) => HOLDS_BUILDER.has(x.substep)).length);
  const taken = inProgress.map((x) => x.scope);
  const open = [phase];
  for (let i = s.phases.indexOf(phase) + 1; i < s.phases.length && s.phases[i].overlap; i++) open.push(s.phases[i]);
  for (const sl of open.flatMap((p) => p.tasks)) {
    if (sl.status !== 'pending') continue;
    const on = sl.blockedBy.filter((b) => !done.has(b));
    if (on.length) {
      result.waiting.push({ task: sl, on });
      continue;
    }
    const clash = taken.some((t) => scopesOverlap(t, sl.scope));
    if (clash || room === 0) {
      result.waiting.push({ task: sl, on: clash ? ['scope overlap with running work'] : ['parallel cap'] });
      continue;
    }
    result.ready.push(sl);
    taken.push(sl.scope);
    room--;
  }
  return result;
}

const WEIGHT = { simple: 1, standard: 2, complex: 3 } as const;

export interface Chain {
  /** Task ids, first to last. */
  tasks: string[];
  /** Summed complexity weight along the chain. */
  weight: number;
  totalWeight: number;
  /** Tasks on the chain, and in the plan. */
  count: number;
  total: number;
}

/**
 * The longest chain of tasks that must run one after another: `blocked_by` edges, plus phase order (every task in a
 * phase follows the whole earlier phase, unless that phase is marked `overlap`, when only its own blocked_by count).
 * A task weighs 1, 2 or 3 by complexity. On a tie the chain that ends earliest in the plan wins.
 */
export function criticalPath(phases: Phase[]): Chain {
  const all = phases.flatMap((p) => p.tasks);
  const best = new Map<string, { weight: number; prev?: string }>();
  const heaviest = (ids: string[]): string | undefined => ids.reduce<string | undefined>((top, id) => (top === undefined || best.get(id)!.weight > best.get(top)!.weight ? id : top), undefined);
  for (const [i, p] of phases.entries()) {
    const barrier = i > 0 && !p.overlap ? heaviest(phases[i - 1].tasks.map((t) => t.id)) : undefined;
    for (const t of p.tasks) {
      const prev = heaviest([...(barrier ? [barrier] : []), ...t.blockedBy.filter((b) => best.has(b))]);
      best.set(t.id, { weight: WEIGHT[t.complexity] + (prev ? best.get(prev)!.weight : 0), prev });
    }
  }
  const end = heaviest(all.map((t) => t.id));
  const tasks: string[] = [];
  for (let c = end; c; c = best.get(c)!.prev) tasks.unshift(c);
  return { tasks, weight: end ? best.get(end)!.weight : 0, totalWeight: all.reduce((n, t) => n + WEIGHT[t.complexity], 0), count: tasks.length, total: all.length };
}

/** "move-app → … → vercel-deploy → docs": the first id and the last two when the chain is long. */
export const chainText = (ids: string[]): string => (ids.length <= 4 ? ids : [ids[0], '…', ...ids.slice(-2)]).join(' → ');
