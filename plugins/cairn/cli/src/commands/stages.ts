import { join } from 'node:path';
import { commitPath, gitOk } from '../git.ts';
import { planRel, type Ctx } from '../locate.ts';
import { currentPhase } from '../ready.ts';
import { nextFor } from '../render.ts';
import { FIX_RECORD_SECTIONS, FIX_RECORD_WORD_BUDGET, PRD_SECTIONS, proseWordCount, sections, uncheckedItems } from '../sections.ts';
import { loadState, log } from '../state.ts';
import { STAGES, type Stage, type State, type Track } from '../types.ts';
import { CliError, hashText, now, readText, Refusal } from '../util.ts';
import type { ProofIO } from '../proof.ts';
import { docProblems, gate, mutate, planCtx, planFile, recordProblems, requireHumanProof, runTests, testsGate, type Opts, type PlanCtx, type Result, type TestRun } from '../shared.ts';
import { configGate, configHash, fastLane } from './fix.ts';

const STAGE_ORDER: Record<Track, Stage[]> = {
  feature: STAGES.filter((x) => x !== 'repro'),
  fix: ['repro', 'execute', 'review', 'ship', 'closed'],
};
const nextStage = (s: State): Stage | undefined => {
  const order = STAGE_ORDER[fastLane(s) ? 'fix' : 'feature'];
  return order[order.indexOf(s.stage) + 1];
};

/** The fix-track record: five sections and a 300-word budget for the prose (FR-27). */
function fixRecordProblems(pc: PlanCtx): string[] {
  const md = readText(planFile(pc, 'RECORD.md'));
  const p = docProblems(md, 'RECORD.md', FIX_RECORD_SECTIONS);
  const n = md ? proseWordCount(md) : 0;
  if (n > FIX_RECORD_WORD_BUDGET) p.push(`RECORD.md is ${n} words; the budget is ${FIX_RECORD_WORD_BUDGET}`);
  return p;
}

const recordCheck = (pc: PlanCtx, track: Track) =>
  track === 'fix'
    ? { problems: fixRecordProblems(pc), fix: 'write RECORD.md from templates/record-fix.md' }
    : { problems: recordProblems(pc), fix: 'write RECORD.md from templates/record.md' };

/** The checks for closing a plan: the record, green tests, and the approved commands. */
function closeGates(pc: PlanCtx, s: State, opts: Opts, record: { problems: string[]; fix: string }, tests: TestRun | undefined): void {
  gate(!record.problems.length, s, 'close', opts, record.problems.join('; '), [record.fix]);
  testsGate(tests, s, 'close', opts);
  configGate(s, pc.cfg, 'close', opts);
}
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
        // Outside the plan stage, approving the plan re-approves changed commands (FR-32) and moves nothing.
        if (s.stage !== 'plan' && s.configHash && s.configHash !== configHash(pc.cfg)) {
          s.configHash = configHash(pc.cfg);
          log(s, 'commands re-approved', source);
          return { message: 'The changed setup, test, and build commands are approved.' };
        }
        gate(s.stage === 'plan', s, 'approve plan', opts, `the plan is in ${s.stage}, not plan`);
        gate(s.phases.length > 0, s, 'approve plan', opts, 'no plan is loaded', ['cairn plan load']);
        gate(!!md && s.planHash === hashText(md), s, 'approve plan', opts, 'plan.md changed since it was loaded', ['cairn plan load']);
        s.approvals.plan = { ...approval(), hash: s.planHash };
        s.configHash = configHash(pc.cfg);
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
        const v = phase.verdict;
        gate(!!v, s, 'approve phase', opts, 'no direction verdict is recorded for this phase', ['run the direction check, then cairn evidence phase']);
        if (v) {
          gate(v.result !== 'red', s, 'approve phase', opts, `the direction verdict is red${v.note ? ` (${v.note})` : ''}`, ['fix what the report flags, then re-run the check and cairn evidence phase']);
          gate(gitOk(['diff', '--quiet', v.commit, 'HEAD', '--', '.', ':!docs/sdlc'], pc.plan.worktree), s, 'approve phase', opts, `code changed since the direction check (verdict at ${v.commit.slice(0, 7)})`, ['re-run the direction check, then cairn evidence phase']);
        }
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
        const record = recordCheck(pc, fastLane(s) ? 'fix' : 'feature');
        gate(!record.problems.length, s, 'approve ship', opts, record.problems.join('; '), [record.fix]);
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
  const pre = loadState(pc.plan.dir);
  // Advancing a fix plan from ship closes it, with the close checks. Tests run before the lock: they can be slow.
  const closing = fastLane(pre) && pre.stage === 'ship';
  const record = closing ? recordCheck(pc, 'fix') : undefined;
  const tests = closing ? runTests(pc.cfg, pc.plan.worktree) : undefined;
  let to: Stage | undefined;
  const r = mutate(pc, undefined, (s) => {
    to = nextStage(s);
    if (!to || s.stage === 'learn') throw new Refusal(s.stage === 'learn' ? 'use `cairn close` to finish the plan' : 'the plan is closed');
    if (typeof opts.to === 'string' && opts.to !== to) throw new Refusal(`the next stage after ${s.stage} is ${to}, not ${opts.to}`);
    if (s.paused) throw new Refusal('the plan is paused', ['cairn resume']);
    switch (s.stage) {
      case 'repro':
        gate(!!s.repro, s, 'advance', opts, 'no repro is recorded', ['cairn repro "<command that fails while the bug is present>"']);
        s.phases = [{ id: 'fix', name: 'Fix', status: 'pending', slices: [{ id: 'fix', name: 'Fix', covers: [], blockedBy: [], scope: ['**'], complexity: 'standard', status: 'pending', fixRound: 0 }] }];
        break;
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
        if (record) closeGates(pc, s, opts, record, tests);
        break;
    }
    s.stage = to;
    if (to === 'execute') {
      const p = currentPhase(s);
      if (p && p.status === 'pending') p.status = 'in_progress';
    }
    log(s, 'advanced', to);
    if (to === 'closed') return { message: `Closed "${s.title}". The record is ${join(pc.plan.dir, 'RECORD.md')}.` };
    return { message: `Moved to ${to}. ${nextFor(s).text}` };
  });
  if (pc.cfg.autoCommit) commitPath(pc.plan.worktree, planRel(pc.plan.slug), `cairn(${pc.plan.slug}): advance to ${to}`);
  return r;
}

export function cmdClose(ctx: Ctx, opts: Opts): Result {
  const pc = planCtx(ctx);
  const record = recordCheck(pc, 'feature');
  const tests = runTests(pc.cfg, pc.plan.worktree);
  return mutate(pc, 'closed', (s) => {
    gate(s.stage === 'learn', s, 'close', opts, `the plan is in ${s.stage}, not learn`);
    closeGates(pc, s, opts, record, tests);
    s.stage = 'closed';
    log(s, 'closed');
    return { message: `Closed "${s.title}". The record is ${join(pc.plan.dir, 'RECORD.md')}.` };
  });
}
