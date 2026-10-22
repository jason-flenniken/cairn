import type { Ctx } from '../locate.ts';
import { allTasks } from '../ready.ts';
import type { ProofIO } from '../proof.ts';
import { levelOf, loadState, log, setStage } from '../state.ts';
import { isLevel, LEVELS, LEVEL_LABEL, type Level, type State } from '../types.ts';
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
  // Refusals first and the proof outside the lock: a --human prompt must not hold the plan's state lock.
  const first = levelCheck(loadState(pc.plan.dir), to);
  if (first.same) return { message: first.message };
  requireHumanProof(to, opts, io, 'level');
  return mutate(pc, 'level changed', (s) => {
    const { from, tasks, started, lowering, same, message } = levelCheck(s, to);
    if (same) return { message };
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
    // Every started task still stamped below the new level, finished or not. A task keeps one open item: a later raise
    // rewrites its target level instead of filing a second, and restamping stops the same raise counting it twice.
    const behind = tasks.filter((t) => t.startedAt && LEVELS.indexOf(levelOf(t)) < LEVELS.indexOf(to));
    const taken = new Set((s.suggestions ?? []).flatMap((x) => [x.resolves, ...(x.merges ?? [])]).filter((k): k is string => !!k));
    let filed = 0;
    for (const t of behind) {
      const prefix = `Task "${t.id}" was built at `;
      const open = (s.suggestions ?? []).find((x) => x.kind === 'hardening' && x.text.startsWith(prefix) && !taken.has(`${s.slug}:${x.id}`));
      const text = `${prefix}${LEVEL_LABEL[levelOf(t)]}: bring it up to ${LEVEL_LABEL[to]} (the reviews and tests that level adds)`;
      if (open) open.text = text;
      else {
        addHardening(s, { area: 'tests', text, where: t.scope });
        filed++;
      }
      t.level = to;
    }
    return { message: `Level raised to ${LEVEL_LABEL[to]}.${filed ? ` ${filed} started task(s) got a hardening item.` : ''}`, data: { level: to, hardening: filed } };
  });
}

/** Every reason the change can't happen, and what it would be; run before the proof and again under the lock. */
function levelCheck(s: State, to: Level) {
  const from = levelOf(s);
  if (s.track === 'fix') throw new Refusal('a fix plan has no level', ['levels apply to feature plans']);
  if (s.paused) throw new Refusal('the plan is paused', ['cairn resume']);
  if (s.stage === 'ship' || s.stage === 'learn' || s.stage === 'closed') throw new Refusal(`the level can't change once the plan is at ${s.stage}`);
  const tasks = allTasks(s);
  const started = tasks.some((t) => t.startedAt);
  const lowering = LEVELS.indexOf(to) < LEVELS.indexOf(from);
  const same = from === to;
  if (!same && lowering && started) throw new Refusal('lowering the level is only allowed before any task starts', [`keep ${LEVEL_LABEL[from]}, or raise it`]);
  return { from, tasks, started, lowering, same, message: `The plan is already at ${LEVEL_LABEL[to]}.` };
}
