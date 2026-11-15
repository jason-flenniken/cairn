import { levelOf } from './state.ts';
import type { Complexity, State, Task } from './types.ts';

export const MAX_FIX_ROUNDS = 2;
export const MODELS = ['haiku', 'sonnet', 'opus'] as const;
export type Model = (typeof MODELS)[number];

export interface Builder {
  model: Model;
  effort?: string;
  reason?: string;
}

const STANDARD: Record<Complexity, Builder> = {
  simple: { model: 'haiku' },
  standard: { model: 'sonnet' },
  complex: { model: 'sonnet', effort: 'high' },
};
// MVP builds one tier below the standard rows, with no extra effort.
const MVP: Record<Complexity, Builder> = { simple: { model: 'haiku' }, standard: { model: 'haiku' }, complex: { model: 'sonnet' } };

/**
 * Who builds a task. The plan's `model:` mark wins (it carries its own reason); otherwise the complexity decides.
 * On the last allowed fix attempt the builder is one tier up (opus stays opus).
 */
export function builderOf(s: Pick<State, 'level'>, t: Pick<Task, 'complexity' | 'model' | 'modelReason'>, fixAttempt = 0): Builder {
  const byRole = (levelOf(s) === 'mvp' ? MVP : STANDARD)[t.complexity];
  // A mark that names the model the complexity would pick anyway keeps that row's effort (sonnet on a complex task stays high).
  let b: Builder = t.model ? { model: t.model, ...(t.model === byRole.model && byRole.effort ? { effort: byRole.effort } : {}), ...(t.modelReason ? { reason: t.modelReason } : {}) } : { ...byRole };
  if (fixAttempt >= MAX_FIX_ROUNDS) {
    const up = MODELS[Math.min(MODELS.indexOf(b.model) + 1, MODELS.length - 1)];
    if (up !== b.model) b = { model: up, reason: 'the last fix attempt goes one tier up' };
  }
  return b;
}

/** `Builder: sonnet, effort high — reason`: the line the main session reads the dispatch from. */
export const builderLine = (b: Builder): string => `Builder: ${b.model}${b.effort ? `, effort ${b.effort}` : ''}${b.reason ? ` — ${b.reason}` : ''}`;

/** Whether a task gets its own task review. MVP skips it; lean Standard keeps it only for risky or complex tasks. */
export function taskReviewOf(t: Pick<Task, 'level' | 'lean' | 'risky' | 'complexity'>): { review: boolean; reason: string } {
  if (levelOf(t) === 'mvp') return { review: false, reason: 'MVP has no task review' };
  if (!t.lean) return { review: true, reason: 'every task is reviewed at this level' };
  if (t.risky) return { review: true, reason: 'the task is risky' };
  if (t.complexity === 'complex') return { review: true, reason: 'the task is complex' };
  return { review: false, reason: 'the branch review covers it' };
}

/** A Standard plan with at least this many tasks gets the Opus branch review. */
export const OPUS_BRANCH_TASKS = 10;

/**
 * Who reviews the whole branch. Polished: opus. MVP: sonnet. Standard: opus when a task is complex, the plan is big,
 * or a task started before lean Standard; otherwise sonnet. Risk does not decide it: risky work already gets a task
 * review and a security review, and the branch gets its own security review.
 */
export function branchReviewerOf(s: Pick<State, 'level'>, tasks: Pick<Task, 'complexity' | 'lean' | 'startedAt'>[]): Builder {
  const level = levelOf(s);
  if (level === 'polished') return { model: 'opus', effort: 'high', reason: 'Polished' };
  if (level === 'mvp') return { model: 'sonnet', effort: 'high', reason: 'MVP' };
  if (tasks.some((t) => t.complexity === 'complex')) return { model: 'opus', effort: 'high', reason: 'a task is complex' };
  if (tasks.length >= OPUS_BRANCH_TASKS) return { model: 'opus', effort: 'high', reason: `${tasks.length} tasks` };
  if (tasks.some((t) => t.startedAt && !t.lean)) return { model: 'opus', effort: 'high', reason: 'tasks started before lean Standard' };
  return { model: 'sonnet', effort: 'high', reason: 'a small plan with no complex task' };
}
