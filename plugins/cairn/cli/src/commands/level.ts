import type { Ctx } from '../locate.ts';
import { allTasks } from '../ready.ts';
import type { ProofIO } from '../proof.ts';
import { levelOf, log, setStage } from '../state.ts';
import { isLevel, LEVELS, LEVEL_LABEL } from '../types.ts';
import { CliError, Refusal } from '../util.ts';
import { addHardening, mutate, planCtx, requireHumanProof, type Opts, type Result } from '../shared.ts';

const USAGE = 'usage: cairn level mvp|standard|polished [--human]';

/**
 * Change the plan's level. Every refusal comes before the proof is spent, and the same level again needs none.
 * A raise re-opens what the old level had settled: the plan approval (before any task starts) and Check or review evidence.
 */
export function cmdLevel(ctx: Ctx, value: string | undefined, opts: Opts, io?: ProofIO): Result {
  if (!value) throw new CliError(USAGE);
  if (!isLevel(value)) throw new Refusal(`"${value}" is not a level: use ${LEVELS.join(', ')}`);
  const to = value;
  const pc = planCtx(ctx);
  return mutate(pc, 'level changed', (s) => {
    const from = levelOf(s);
    if (s.track === 'fix') throw new Refusal('a fix plan has no level', ['levels apply to feature plans']);
    if (s.paused) throw new Refusal('the plan is paused', ['cairn resume']);
    if (s.stage === 'ship' || s.stage === 'learn' || s.stage === 'closed') throw new Refusal(`the level can't change once the plan is at ${s.stage}`);
    if (from === to) return { message: `The plan is already at ${LEVEL_LABEL[to]}.` };
    const tasks = allTasks(s);
    const started = tasks.some((t) => t.startedAt);
    const lowering = LEVELS.indexOf(to) < LEVELS.indexOf(from);
    if (lowering && started) throw new Refusal('lowering the level is only allowed before any task starts', [`keep ${LEVEL_LABEL[from]}, or raise it`]);
    requireHumanProof(to, opts, io, 'level');
    s.level = to;
    log(s, 'level changed', `${from} -> ${to}`);
    if (lowering) return { message: `Level lowered to ${LEVEL_LABEL[to]}.`, data: { level: to } };
    if (!started && s.approvals.plan) {
      delete s.approvals.plan;
      if (s.stage === 'execute') setStage(s, 'plan');
    }
    if (s.evidence.verify) {
      delete s.evidence.verify;
      if (s.stage === 'review') setStage(s, 'verify');
    }
    delete s.evidence.review;
    const behind = tasks.filter((t) => t.status === 'done' && LEVELS.indexOf(levelOf(t)) < LEVELS.indexOf(to));
    for (const t of behind)
      addHardening(s, { area: 'tests', text: `Task "${t.id}" was built at ${LEVEL_LABEL[levelOf(t)]}: bring it up to ${LEVEL_LABEL[to]} (the reviews and tests that level adds)`, where: t.scope });
    return { message: `Level raised to ${LEVEL_LABEL[to]}.${behind.length ? ` ${behind.length} finished task(s) got a hardening item.` : ''}`, data: { level: to, hardening: behind.length } };
  });
}
