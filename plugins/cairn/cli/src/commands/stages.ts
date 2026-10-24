import { join } from 'node:path';
import { commitPath } from '../git.ts';
import { planRelOf, type Ctx } from '../locate.ts';
import { allTasks, currentPhase } from '../ready.ts';
import { nextFor } from '../render.ts';
import { FIX_RECORD_SECTIONS, FIX_RECORD_WORD_BUDGET, PRD_SECTIONS, proseWordCount, sections, uncheckedItems } from '../sections.ts';
import { levelOf, loadState, log, setStage } from '../state.ts';
import { STAGES, type Stage, type State, type Track } from '../types.ts';
import { CliError, hashText, now, readText, Refusal } from '../util.ts';
import type { ProofIO } from '../proof.ts';
import { addHardening, docProblems, gate, mutate, planCtx, planFile, recordProblems, requireHumanProof, runTests, testsGate, type Opts, type PlanCtx, type Result, type TestRun } from '../shared.ts';
import { configGate, configHash, fastLane } from './fix.ts';
import { collectSuggestions, MAX_OPEN_PER_PLAN } from './suggest.ts';

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
  configGate(s, pc.cfg, 'close', opts);
  const open = collectSuggestions(pc.ctx).filter((x) => x.open && !x.hardening && x.slug === s.slug);
  gate(
    open.length <= MAX_OPEN_PER_PLAN,
    s,
    'close',
    opts,
    `${open.length} open follow-ups from this plan; at most ${MAX_OPEN_PER_PLAN} may stay open: ${open.map((x) => `${x.key} (${x.text})`).join('; ')}`,
    ['group related ones: cairn suggest merge <key>... --area <a> --text "<high-level item>"', 'drop trivia: cairn suggest resolve <key> --dismiss --note "<reason>"', 'then list what was dropped in the record'],
  );
  gate(!record.problems.length, s, 'close', opts, record.problems.join('; '), [record.fix]);
  testsGate(tests, s, 'close', opts);
}
/** Why prd.md cannot be approved yet: missing or empty sections, open questions. */
function prdProblems(md: string | undefined): string[] {
  const problems = docProblems(md, 'prd.md', PRD_SECTIONS);
  const open = uncheckedItems(md ? sections(md).get('open questions') : '');
  if (open.length) problems.push(`prd.md has ${open.length} open question(s): ${open.join(' | ')}`);
  return problems;
}

export interface Ready {
  kind: 'prd' | 'plan' | 'ship';
  file: string;
  summary: string;
}

const firstSentence = (text = '') => (text.replace(/\s+/g, ' ').trim().match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text.trim());

function prdSummary(md: string): string {
  const sec = sections(md);
  const reqs = (sec.get('requirements') ?? '').split('\n').filter((l) => /\bFR-\d+\b/.test(l)).map((l) => `- ${l.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, '').split(/Check:/)[0].trim()}`);
  return [firstSentence(sec.get('problem')), '', '**Requirements**', ...reqs, '', '**Non-goals**', sec.get('non-goals') ?? ''].join('\n').trim();
}

function planSummary(s: State): string {
  return s.phases
    .flatMap((ph, i) => [`${i + 1}. **${ph.name}**`, ...ph.tasks.map((t) => `   - ${t.name} (${t.complexity})${t.risky ? ' risky' : ''}`)])
    .join('\n');
}

/** True when prd.md no longer matches the text the user approved. */
export function prdEditedSinceApproval(s: State, prd: string | undefined): boolean {
  return !!s.approvals.prd?.hash && !!prd && hashText(prd) !== s.approvals.prd.hash;
}

const PRD_EDITED_NOTE = '**prd.md changed after you approved it; approving the plan also accepts those edits.**';

/** The stop the plan is waiting on, when approving it now would pass its checks. Never throws. */
export function readyFor(pc: { plan: { dir: string } }): Ready | undefined {
  try {
    const s = loadState(pc.plan.dir);
    const file = (name: string) => join(pc.plan.dir, name);
    const pcLike = pc as PlanCtx;
    if (s.stage === 'prd' && !s.approvals.prd) {
      const md = readText(file('prd.md'));
      return md && !prdProblems(md).length ? { kind: 'prd', file: file('prd.md'), summary: prdSummary(md) } : undefined;
    }
    if (s.stage === 'plan' && !s.approvals.plan) {
      const md = readText(file('plan.md'));
      if (!s.phases.length || !md || s.planHash !== hashText(md)) return undefined;
      const note = prdEditedSinceApproval(s, readText(file('prd.md'))) ? `${PRD_EDITED_NOTE}\n\n` : '';
      return { kind: 'plan', file: file('plan.md'), summary: note + planSummary(s) };
    }
    if (s.stage === 'ship' && !s.approvals.ship && s.evidence.review?.result === 'pass') {
      if (recordCheck(pcLike, fastLane(s) ? 'fix' : 'feature').problems.length) return undefined;
      const md = readText(file('RECORD.md')) ?? '';
      return { kind: 'ship', file: file('RECORD.md'), summary: (sections(md).get('what was built') ?? '').trim() };
    }
  } catch {
    // Not ready: the state or a document could not be read.
  }
  return undefined;
}

const APPROVAL_KINDS = ['prd', 'plan', 'ship'];
const APPROVE_USAGE = 'usage: cairn approve prd|plan|ship [--human] [--note "…"]';

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
        const problems = prdProblems(md);
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
        // PRD edits made while planning ride this approval: the user sees the note on the card and in the question.
        const prd = readText(planFile(pc, 'prd.md'));
        if (prdEditedSinceApproval(s, prd)) {
          s.approvals.prd = { ...approval(), hash: hashText(prd as string) };
          log(s, 'PRD edits accepted with the plan', source);
          return { message: 'Plan approved, and the PRD edits with it. Next: `cairn advance` to execution.' };
        }
        return { message: 'Plan approved. Next: `cairn advance` to execution.' };
      });
    }
    case 'ship':
      return mutate(pc, 'ship approved', (s) => {
        gate(s.stage === 'ship', s, 'approve ship', opts, `the plan is in ${s.stage}, not ship`);
        gate(s.evidence.review?.result === 'pass', s, 'approve ship', opts, 'review has not passed', ['run the review procedure, then cairn evidence review pass']);
        const record = recordCheck(pc, fastLane(s) ? 'fix' : 'feature');
        gate(!record.problems.length, s, 'approve ship', opts, record.problems.join('; '), [record.fix]);
        s.approvals.ship = approval();
        log(s, 'ship approved', source);
        return { message: 'Ship approved. Next: open the PR, then `cairn advance`; offer the merge last.' };
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
  // A changed command never runs before this check (an override needs the user's proof first).
  if (closing) configGate(pre, pc.cfg, 'close', opts);
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
        // Not overridable: without a repro the plan would leave the fast lane.
        if (!s.repro) throw new Refusal('no repro is recorded', ['cairn repro "<command that fails while the bug is present>"']);
        s.phases = [{ id: 'fix', name: 'Fix', status: 'pending', tasks: [{ id: 'fix', name: 'Fix', covers: [], blockedBy: [], scope: ['**'], complexity: 'standard', status: 'pending', fixRound: 0 }] }];
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
        gate(s.phases.every((p) => p.status === 'done'), s, 'advance', opts, 'not every phase is finished', ['cairn phase finish']);
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
    // An MVP task that was not flagged risky skipped its per-task review: say so, scoped to the task.
    if (to === 'ship' && levelOf(s) === 'mvp')
      for (const t of allTasks(s))
        if (t.status === 'done' && t.level === 'mvp' && !t.risky) addHardening(s, { area: 'quality', text: `Task "${t.name}" ran at MVP without a per-task review.`, where: t.scope });
    setStage(s, to);
    if (to === 'execute') {
      const p = currentPhase(s);
      if (p && p.status === 'pending') p.status = 'in_progress';
    }
    log(s, 'advanced', to);
    if (to === 'closed') return { message: `Closed "${s.title}". The record is ${join(pc.plan.dir, 'RECORD.md')}.` };
    return { message: `Moved to ${to}. ${nextFor(s).text}` };
  });
  if (pc.cfg.autoCommit) commitPath(pc.plan.worktree, planRelOf(pc.plan), `cairn(${pc.plan.slug}): advance to ${to}`);
  return r;
}

export function cmdClose(ctx: Ctx, opts: Opts): Result {
  const pc = planCtx(ctx);
  configGate(loadState(pc.plan.dir), pc.cfg, 'close', opts);
  const record = recordCheck(pc, 'feature');
  const tests = runTests(pc.cfg, pc.plan.worktree);
  return mutate(pc, 'closed', (s) => {
    gate(s.stage === 'learn', s, 'close', opts, `the plan is in ${s.stage}, not learn`);
    closeGates(pc, s, opts, record, tests);
    setStage(s, 'closed');
    log(s, 'closed');
    return { message: `Closed "${s.title}". The record is ${join(pc.plan.dir, 'RECORD.md')}.` };
  });
}
