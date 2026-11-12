import { type Ctx } from '../locate.ts';
import { log } from '../state.ts';
import { STEPS } from '../types.ts';
import { now, readText, Refusal } from '../util.ts';
import { mutate, planCtx, planFile, type Opts, type Result } from '../shared.ts';
import { prdApprovalProblems } from './stages.ts';

const NAME = /^[a-z-]{1,20}$/;
const COUNT = /^\d{1,6}$/;

/** `cairn step <name> [--count N]`: record what the current stage (prd, plan, check, review or ship) is doing now. */
export function cmdStep(ctx: Ctx, name: string | undefined, opts: Opts): Result {
  const pc = planCtx(ctx);
  const count = opts.count;
  if (count !== undefined && !(typeof count === 'string' && COUNT.test(count))) throw new Refusal('--count must be a whole number, 0 or more');
  return mutate(pc, undefined, (s) => {
    const valid = STEPS[s.stage];
    if (!valid) throw new Refusal(`there are no steps at ${s.stage}; steps exist at ${Object.keys(STEPS).join(', ')}`);
    const list = valid.join(', ');
    if (!name) throw new Refusal(`usage: cairn step <name> [--count N]; at ${s.stage}: ${list}`);
    // Never echo a name that is not plain lowercase text.
    if (!NAME.test(name) || !valid.includes(name))
      throw new Refusal(`${NAME.test(name) ? `"${name}"` : 'that name'} is not a step at ${s.stage}; valid steps: ${list}`);
    // The user is asked to approve once the step is `approving`, so a PRD that approval would refuse goes back first.
    if (s.stage === 'prd' && name === 'approving' && !s.approvals.prd) {
      const problems = prdApprovalProblems(s, readText(planFile(pc, 'prd.md')));
      if (problems.length) throw new Refusal(`prd.md is not ready to approve: ${problems.join('; ')}`, ['fix prd.md, then run `cairn step approving` again']);
    }
    s.step = { stage: s.stage, name, ...(count !== undefined ? { count: Number(count) } : {}), at: now() };
    log(s, 'step', `${name}${count !== undefined ? ` (${count})` : ''}`);
    return { message: `Step at ${s.stage}: ${name}${count !== undefined ? ` (${count})` : ''}.`, data: { step: s.step } };
  });
}
