import { join } from 'node:path';
import { commitPath } from '../git.ts';
import { planRel, type Ctx } from '../locate.ts';
import { currentPhase } from '../ready.ts';
import { nextFor } from '../render.ts';
import { PRD_SECTIONS, sections, uncheckedItems } from '../sections.ts';
import { log } from '../state.ts';
import { STAGES, type Stage } from '../types.ts';
import { CliError, hashText, now, readText, Refusal } from '../util.ts';
import type { ProofIO } from '../proof.ts';
import { docProblems, gate, mutate, planCtx, planFile, recordProblems, requireHumanProof, runTests, testsGate, type Opts, type Result } from '../shared.ts';

const STAGE_ORDER: Stage[] = [...STAGES];
const nextStage = (s: Stage): Stage | undefined => STAGE_ORDER[STAGE_ORDER.indexOf(s) + 1];
const APPROVAL_KINDS = ['prd', 'plan', 'phase', 'ship'];
const APPROVE_USAGE = 'usage: cairn approve prd|plan|phase|ship [--human] [--note "…"]';

export function cmdApprove(ctx: Ctx, kind: string | undefined, opts: Opts, io?: ProofIO): Result {
  if (!kind || !APPROVAL_KINDS.includes(kind)) throw new CliError(APPROVE_USAGE);
  const pc = planCtx(ctx);
  const source = requireHumanProof(kind, opts, io);
  const approval = () => ({ at: now(), via: 'human' as const, source, ...(opts.note ? { note: String(opts.note) } : {}) });
  switch (kind) {
    case 'prd': {
      const md = readText(planFile(pc, 'prd.md'));
      return mutate(pc, 'PRD approved', (s) => {
        gate(s.stage === 'prd', s, 'approve prd', opts, `the plan is in ${s.stage}, not prd`);
        const problems = docProblems(md, 'prd.md', PRD_SECTIONS);
        const open = uncheckedItems(md ? sections(md).get('open questions') : '');
        if (open.length) problems.push(`prd.md has ${open.length} open question(s): ${open.join(' | ')}`);
        gate(!problems.length, s, 'approve prd', opts, problems.join('; '), ['finish prd.md, resolving open questions with the user']);
        s.approvals.prd = { ...approval(), hash: md ? hashText(md) : undefined };
        log(s, 'PRD approved', source);
        return { message: 'PRD approved. Next: `cairn advance` to planning.' };
      });
    }
    case 'plan': {
      const md = readText(planFile(pc, 'plan.md'));
      return mutate(pc, 'plan approved', (s) => {
        gate(s.stage === 'plan', s, 'approve plan', opts, `the plan is in ${s.stage}, not plan`);
        gate(s.phases.length > 0, s, 'approve plan', opts, 'no plan is loaded', ['cairn plan load']);
        gate(!!md && s.planHash === hashText(md), s, 'approve plan', opts, 'plan.md changed since it was loaded', ['cairn plan load']);
        s.approvals.plan = { ...approval(), hash: s.planHash };
        log(s, 'plan approved', source);
        return { message: 'Plan approved. Next: `cairn advance` to execution.' };
      });
    }
    case 'phase':
      return mutate(pc, 'phase approved', (s) => {
        const phase = currentPhase(s);
        if (!phase) throw new Refusal('every phase is already approved');
        gate(s.stage === 'execute', s, 'approve phase', opts, `the plan is in ${s.stage}, not execute`);
        gate(phase.status === 'awaiting_approval', s, 'approve phase', opts, `phase "${phase.name}" still has unfinished slices`, ['finish them (cairn ready / cairn slice done)']);
        const drift = s.drift.filter((d) => !d.acked);
        gate(!drift.length, s, 'approve phase', opts, `drift not reviewed: ${drift.map((d) => d.path).join(', ')}`, ['review each with the user, then cairn drift ack <path> --note "…" (or --all)']);
        phase.status = 'done';
        log(s, 'phase approved', `${phase.name} (source: ${source})`);
        const following = currentPhase(s);
        if (following) {
          following.status = 'in_progress';
          return { message: `Phase "${phase.name}" approved. Next phase: "${following.name}".` };
        }
        s.stage = 'verify';
        log(s, 'advanced', 'verify');
        return { message: `Phase "${phase.name}" approved. All phases done; the plan moved to Verify.` };
      });
    case 'ship':
      return mutate(pc, 'ship approved', (s) => {
        gate(s.stage === 'ship', s, 'approve ship', opts, `the plan is in ${s.stage}, not ship`);
        gate(s.evidence.review?.result === 'pass', s, 'approve ship', opts, 'review has not passed', ['run the review procedure, then cairn evidence review pass']);
        const problems = recordProblems(pc);
        gate(!problems.length, s, 'approve ship', opts, problems.join('; '), ['write RECORD.md from templates/record.md']);
        s.approvals.ship = approval();
        log(s, 'ship approved', source);
        return { message: 'Ship approved. Next: open the PR, then `cairn advance`.' };
      });
    default:
      throw new CliError(APPROVE_USAGE);
  }
}

export function cmdAdvance(ctx: Ctx, opts: Opts): Result {
  const pc = planCtx(ctx);
  const decisions = readText(planFile(pc, 'decisions.md')) ?? '';
  let to: Stage | undefined;
  const r = mutate(pc, undefined, (s) => {
    to = nextStage(s.stage);
    if (!to || s.stage === 'learn') throw new Refusal(s.stage === 'learn' ? 'use `cairn close` to finish the plan' : 'the plan is closed');
    if (typeof opts.to === 'string' && opts.to !== to) throw new Refusal(`the next stage after ${s.stage} is ${to}, not ${opts.to}`);
    if (s.paused) throw new Refusal('the plan is paused', ['cairn resume']);
    switch (s.stage) {
      case 'discover':
        gate(/^### /m.test(decisions), s, 'advance', opts, 'no decisions recorded yet', ['cairn decide "<question>" "<answer>"']);
        break;
      case 'prd':
        gate(!!s.approvals.prd, s, 'advance', opts, 'the PRD is not approved', ['cairn approve prd']);
        break;
      case 'plan':
        gate(!!s.approvals.plan && s.phases.length > 0, s, 'advance', opts, 'the plan is not approved', ['cairn approve plan']);
        break;
      case 'execute':
        gate(s.phases.every((p) => p.status === 'done'), s, 'advance', opts, 'not every phase is approved', ['finish and approve the remaining phases']);
        break;
      case 'verify':
        gate(s.evidence.verify?.result === 'pass', s, 'advance', opts, 'verification has not passed', ['cairn evidence verify pass --note "…"']);
        break;
      case 'review':
        gate(s.evidence.review?.result === 'pass' && !s.evidence.review.blocking, s, 'advance', opts, 'review has not passed with zero blocking findings', ['cairn evidence review pass --blocking 0']);
        break;
      case 'ship':
        gate(!!s.approvals.ship, s, 'advance', opts, 'shipping is not approved', ['cairn approve ship']);
        break;
    }
    s.stage = to;
    if (to === 'execute') {
      const p = currentPhase(s);
      if (p && p.status === 'pending') p.status = 'in_progress';
    }
    log(s, 'advanced', to);
    return { message: `Moved to ${to}. ${nextFor(s).text}` };
  });
  if (pc.cfg.autoCommit) commitPath(pc.plan.worktree, planRel(pc.plan.slug), `cairn(${pc.plan.slug}): advance to ${to}`);
  return r;
}

export function cmdClose(ctx: Ctx, opts: Opts): Result {
  const pc = planCtx(ctx);
  const problems = recordProblems(pc);
  const tests = runTests(pc.cfg, pc.plan.worktree);
  return mutate(pc, 'closed', (s) => {
    gate(s.stage === 'learn', s, 'close', opts, `the plan is in ${s.stage}, not learn`);
    gate(!problems.length, s, 'close', opts, problems.join('; '), ['write RECORD.md from templates/record.md']);
    testsGate(tests, s, 'close', opts);
    s.stage = 'closed';
    log(s, 'closed');
    return { message: `Closed "${s.title}". The record is ${join(pc.plan.dir, 'RECORD.md')}.` };
  });
}
