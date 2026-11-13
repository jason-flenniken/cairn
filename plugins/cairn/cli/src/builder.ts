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
  let b: Builder = t.model ? { model: t.model, ...(t.modelReason ? { reason: t.modelReason } : {}) } : { ...(levelOf(s) === 'mvp' ? MVP : STANDARD)[t.complexity] };
  if (fixAttempt >= MAX_FIX_ROUNDS) {
    const up = MODELS[Math.min(MODELS.indexOf(b.model) + 1, MODELS.length - 1)];
    if (up !== b.model) b = { model: up, reason: 'the last fix attempt goes one tier up' };
  }
  return b;
}

/** `Builder: sonnet, effort high — reason`: the line the main session reads the dispatch from. */
export const builderLine = (b: Builder): string => `Builder: ${b.model}${b.effort ? `, effort ${b.effort}` : ''}${b.reason ? ` — ${b.reason}` : ''}`;
