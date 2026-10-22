import type { Ctx } from '../locate.ts';
import { mergeProgress, parsePlan } from '../plan-parse.ts';
import { allTasks } from '../ready.ts';
import { log, setStage } from '../state.ts';
import { hashText, readText, Refusal } from '../util.ts';
import { mutate, planCtx, planFile, type Opts, type Result } from '../shared.ts';

export function cmdPlanLoad(ctx: Ctx, opts: Opts): Result {
  const pc = planCtx(ctx);
  const planMd = readText(planFile(pc, 'plan.md'));
  const prdMd = readText(planFile(pc, 'prd.md')) ?? '';
  if (!planMd) throw new Refusal('plan.md does not exist', ['write it from templates/plan.md']);
  const parsed = parsePlan(planMd, prdMd);
  if (parsed.problems.length) throw new Refusal(`plan.md is not loadable:\n  - ${parsed.problems.join('\n  - ')}`, ['fix plan.md, then cairn plan load']);
  return mutate(pc, 'plan loaded', (s) => {
    const replanning = s.stage !== 'plan';
    if (replanning && !opts.replan) throw new Refusal(`the plan is in ${s.stage}; changing it mid-flight is a re-plan`, ['cairn plan load --replan']);
    if (!['plan', 'execute', 'verify', 'review'].includes(s.stage)) throw new Refusal(`a plan can't be loaded in ${s.stage}`);
    const dropsFix = s.log.some((l) => l.event === 'escalated') && allTasks(s).some((x) => x.id === 'fix') && !parsed.phases.some((p) => p.tasks.some((x) => x.id === 'fix'));
    if (dropsFix) throw new Refusal('the new plan drops the "fix" task that escalate kept', ['keep a task with id "fix" in plan.md']);
    const { phases, lostDone } = mergeProgress(parsed.phases, s.phases);
    if (lostDone.length) throw new Refusal(`the new plan drops tasks that already started or finished: ${lostDone.join(', ')}`, ['keep them in plan.md']);
    s.phases = phases;
    s.planHash = hashText(planMd);
    if (replanning) {
      setStage(s, 'plan');
      delete s.approvals.plan;
      delete s.evidence.verify;
      delete s.evidence.review;
      for (const p of s.phases) delete p.verdict;
      log(s, 're-plan loaded', `${allTasks(s).length} tasks`);
    } else log(s, 'plan loaded', `${s.phases.length} phases, ${allTasks(s).length} tasks`);
    return {
      message: `Loaded ${s.phases.length} phases and ${allTasks(s).length} tasks.${replanning ? ' The plan needs approval again.' : ''} Next: approve the plan with the user.`,
      data: { phases: s.phases.map((p) => ({ id: p.id, name: p.name, tasks: p.tasks.map((x) => x.id) })) },
    };
  });
}
