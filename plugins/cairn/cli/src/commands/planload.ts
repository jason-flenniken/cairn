import type { Ctx } from '../locate.ts';
import { mergeProgress, parsePlan } from '../plan-parse.ts';
import { allTasks, chainText, criticalPath } from '../ready.ts';
import { crossPlanScopeWarnings } from './status.ts';
import { log, setStage } from '../state.ts';
import { hashText, readText, Refusal } from '../util.ts';
import { isFoundational, isPublished, issueOrderProblems, linearConfig, taskTickets } from '../linear.ts';
import { sections } from '../sections.ts';
import { loadState } from '../state.ts';
import { onPlanLoaded } from './linear.ts';
import { keepPublishedTickets } from './publish.ts';
import { mutate, planCtx, planFile, type Opts, type Result } from '../shared.ts';
import { parseProofs, proofsRequired, type ParsedProofs } from '../endproofs.ts';
import type { EndProofs } from '../types.ts';

export function cmdPlanLoad(ctx: Ctx, opts: Opts): Result {
  const pc = planCtx(ctx);
  const planMd = readText(planFile(pc, 'plan.md'));
  const prdMd = readText(planFile(pc, 'prd.md')) ?? '';
  if (!planMd) throw new Refusal('plan.md does not exist', ['write it from templates/plan.md']);
  const parsed = parsePlan(planMd, prdMd);
  // Issues pulled from Linear keep their blocked-by order: a task for a blocked issue comes after the blocker's tasks.
  const link = loadState(pc.plan.dir).linear;
  if (link && !parsed.problems.length) parsed.problems.push(...issueOrderProblems(link, parsed.phases, prdMd, planMd));
  // A foundational issue asks for an explicit approach: the plan names the one chosen and each one rejected.
  const approaches = (sections(planMd).get('approaches considered') ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();
  // The template's placeholders (<approach>, <reason>) are not an approach.
  if (isFoundational(link, linearConfig(pc.cfg)) && (!approaches || /<(approach|reason)>/.test(approaches)))
    parsed.problems.push('this plan is foundational (an issue carries the foundational label), and plan.md has no ## Approaches considered: name the approach chosen and each one rejected, with a reason');
  // End-state proofs: written before the plan is approved, so the build has a done it can't redefine.
  const proofsMd = readText(planFile(pc, 'proofs.md'));
  const proofs: ParsedProofs | undefined = proofsMd ? parseProofs(proofsMd, prdMd, planMd, pc.plan.worktree) : undefined;
  if (proofs) parsed.problems.push(...proofs.problems);
  else if (proofsRequired(loadState(pc.plan.dir))) parsed.problems.push('proofs.md does not exist: the proof-writer writes it (and the proof code) before the plan is loaded');
  if (parsed.problems.length) throw new Refusal(`plan.md is not loadable:\n  - ${parsed.problems.join('\n  - ')}`, ['fix plan.md, then cairn plan load']);
  return mutate(pc, 'plan loaded', (s) => {
    const replanning = s.stage !== 'plan';
    if (replanning && !opts.replan) throw new Refusal(`the plan is in ${s.stage}; changing it mid-flight is a re-plan`, ['cairn plan load --replan']);
    if (!['plan', 'execute', 'verify', 'review'].includes(s.stage)) throw new Refusal(`a plan can't be loaded in ${s.stage}`);
    const dropsFix = s.log.some((l) => l.event === 'escalated') && allTasks(s).some((x) => x.id === 'fix') && !parsed.phases.some((p) => p.tasks.some((x) => x.id === 'fix'));
    if (dropsFix) throw new Refusal('the new plan drops the "fix" task that escalate kept', ['keep a task with id "fix" in plan.md']);
    const { phases, lostDone } = mergeProgress(parsed.phases, s.phases);
    if (lostDone.length) throw new Refusal(`the new plan drops tasks that already started or finished: ${lostDone.join(', ')}`, ['keep them in plan.md']);
    // Each task builds one ticket, so a ticket's status in Linear can move when its own tasks do.
    if (s.linear && isPublished(s.linear)) keepPublishedTickets(s.linear, phases);
    else if (s.linear) {
      const { issueOf, spans } = taskTickets(s.linear, phases, prdMd);
      const started = new Set(allTasks(s).filter((x) => x.status !== 'pending').map((x) => x.id));
      const open = spans.filter((x) => !started.has(x.task));
      if (open.length)
        throw new Refusal(`each task builds one ticket, and ${open.map((x) => `task "${x.task}" covers requirements of ${x.keys.join(' and ')}`).join('; ')}`, [
          'split each such task into one task per ticket in plan.md, then cairn plan load',
        ]);
      for (const t of phases.flatMap((p) => p.tasks)) {
        const k = issueOf.get(t.id);
        if (k) t.issue = k;
        else delete t.issue;
      }
    }
    s.phases = phases;
    s.planHash = hashText(planMd);
    if (proofs && proofsMd) s.endProofs = mergeProofs(s.endProofs, proofs, hashText(proofsMd));
    onPlanLoaded(s);
    if (replanning) {
      setStage(s, 'plan');
      delete s.approvals.plan;
      delete s.evidence.verify;
      delete s.evidence.review;
      for (const p of s.phases) delete p.verdict;
      log(s, 're-plan loaded', `${allTasks(s).length} tasks`);
      // A re-plan changes how the goal is reached, not the goal: recorded for the pull request, never asked.
      if (s.approvals.prd || s.repro) (s.calls ??= []).push({ at: new Date().toISOString(), event: 're-plan', what: `the plan was changed mid-build (${allTasks(s).length} tasks now)`, why: typeof opts.call === 'string' && opts.call.trim() ? opts.call.trim() : 'no reason given' });
    } else log(s, 'plan loaded', `${s.phases.length} phases, ${allTasks(s).length} tasks`);
    // Reports only: a serial plan or a shared file is the user's call, never a refusal.
    const chain = criticalPath(s.phases);
    const chainLine = chain.total ? `\nLongest chain: ${chain.count} of ${chain.total} tasks (${chainText(chain.tasks)}); at most ${pc.cfg.maxParallel} at once.` : '';
    const clashes = crossPlanScopeWarnings(pc.ctx, s.slug, s.phases);
    const opus = allTasks(s).filter((x) => x.model === 'opus');
    const opusLine = opus.length ? `\nOpus builds: ${opus.map((x) => `${x.name} (${x.modelReason})`).join(', ')}.` : '';
    return {
      message: `Loaded ${s.phases.length} phases and ${allTasks(s).length} tasks.${replanning ? ' The re-plan is recorded for the pull request (give the reason with --call).' : ''}${chainLine}${opusLine}${clashes.map((c) => `\nWarning: ${c}`).join('')}\nNext: see every proof fail (cairn prove), then cairn advance. No approval is needed.`,
      data: { phases: s.phases.map((p) => ({ id: p.id, name: p.name, tasks: p.tasks.map((x) => x.id) })), chain, warnings: clashes },
    };
  });
}

/**
 * Load proofs.md over what the plan had: a proof that keeps its id keeps its runs and its lock (a re-plan's approval
 * re-locks it). Proofs added during the build are add-only, so a re-plan that leaves them out keeps them.
 */
function mergeProofs(prev: EndProofs | undefined, next: ParsedProofs, hash: string): EndProofs {
  const old = new Map((prev?.list ?? []).map((p) => [p.id, p]));
  const list = next.list.map((p) => {
    const o = old.get(p.id);
    return o ? { ...p, ...(o.lock ? { lock: o.lock } : {}), ...(o.seenRed ? { seenRed: o.seenRed } : {}), ...(o.last ? { last: o.last } : {}), ...(o.added ? { added: o.added } : {}), ...(o.retired ? { retired: o.retired } : {}) } : p;
  });
  for (const o of prev?.list ?? []) if (o.added && !list.some((p) => p.id === o.id)) list.push(o);
  return { ...(prev?.required ? { required: true } : {}), hash, list, notProvable: next.notProvable };
}
