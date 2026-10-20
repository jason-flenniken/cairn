import { scopesOverlap } from './glob.ts';
import type { Phase, Slice, State } from './types.ts';

export const currentPhase = (s: State): Phase | undefined => s.phases.find((p) => p.status !== 'done');
export const allSlices = (s: State): Slice[] => s.phases.flatMap((p) => p.slices);
export const findSlice = (s: State, id: string): Slice | undefined => allSlices(s).find((x) => x.id === id);

export interface ReadyResult {
  ready: Slice[];
  inProgress: Slice[];
  waiting: { slice: Slice; on: string[] }[];
  phase?: Phase;
}

/** Slices in the current phase that can start now: blockers done, scope disjoint from running work, under the cap. */
export function readySet(s: State, maxParallel: number): ReadyResult {
  const phase = currentPhase(s);
  const done = new Set(allSlices(s).filter((x) => x.status === 'done').map((x) => x.id));
  const inProgress = allSlices(s).filter((x) => x.status === 'in_progress');
  const result: ReadyResult = { ready: [], inProgress, waiting: [], phase };
  if (!phase || s.stage !== 'execute' || s.paused) return result;
  let room = Math.max(0, maxParallel - inProgress.length);
  const taken = inProgress.map((x) => x.scope);
  for (const sl of phase.slices) {
    if (sl.status !== 'pending') continue;
    const on = sl.blockedBy.filter((b) => !done.has(b));
    if (on.length) {
      result.waiting.push({ slice: sl, on });
      continue;
    }
    const clash = taken.some((t) => scopesOverlap(t, sl.scope));
    if (clash || room === 0) {
      result.waiting.push({ slice: sl, on: clash ? ['scope overlap with running work'] : ['parallel cap'] });
      continue;
    }
    result.ready.push(sl);
    taken.push(sl.scope);
    room--;
  }
  return result;
}
