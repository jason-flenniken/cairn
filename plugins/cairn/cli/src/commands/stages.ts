import { join } from 'node:path';
import { commitPath, git } from '../git.ts';
import { planRelOf, type Ctx } from '../locate.ts';
import { allTasks, currentPhase } from '../ready.ts';
import { nextFor } from '../render.ts';
import { FIX_RECORD_SECTIONS, FIX_RECORD_WORD_BUDGET, PRD_SECTIONS, proseWordCount, sections, uncheckedItems } from '../sections.ts';
import { levelOf, loadState, log, setStage } from '../state.ts';
import { STAGES, type Config, type Stage, type State, type Track } from '../types.ts';
import { CliError, hashText, now, readText, Refusal } from '../util.ts';
import type { ProofIO } from '../proof.ts';
import { addHardening, docProblems, gate, mutate, planCtx, planFile, recordProblems, requireHumanProof, reusedRun, runTests, suiteGreenAtHead, testsGate, type Opts, type PlanCtx, type Result, type TestRun } from '../shared.ts';
import { closeMemory } from './memory.ts';
import { proofApprovalProblems, proofProblems, proofSummary } from './prove.ts';
import { filesHash } from '../endproofs.ts';
import { fastLane } from './fix.ts';
import { collectSuggestions, MAX_OPEN_PER_PLAN } from './suggest.ts';
import { isFoundational, isPublished, linearConfig, prdLinearProblems } from '../linear.ts';
import { followupsFor, linearPrdGate, onAdvance, onPrdApproved, recordRequirements, type FollowupInfo } from './linear.ts';

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

/** The checks for closing a plan: the record and green tests. */
function closeGates(pc: PlanCtx, s: State, opts: Opts, record: { problems: string[]; fix: string }, tests: TestRun | undefined): void {
  const open = collectSuggestions(pc.ctx).filter((x) => x.open && !x.hardening && x.slug === s.slug);
  gate(
    open.length <= MAX_OPEN_PER_PLAN,
    s,
    'close',
    opts,
    `${open.length} open follow-ups from this plan; at most ${MAX_OPEN_PER_PLAN} may stay open: ${open.map((x) => `${x.key} (${x.text})`).join('; ')}`,
    ['group related ones: cairn suggest merge <key>... --area <a> --text "<high-level item>"', 'drop trivia: cairn suggest resolve <key> --dismiss --note "<reason>"', 'then list what was dropped in the record'],
    'how',
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

/** Everything `approve prd` would refuse over, Linear tags included. Empty when the PRD can be approved. */
/** The PRD's Linear problems `approve prd` and `approve plan` refuse on: none once the plan's issues are published. */
function prdLinearIssues(s: State, md: string | undefined): string[] {
  return s.linear && md && !isPublished(s.linear) ? prdLinearProblems(s.linear, md) : [];
}

export function prdApprovalProblems(s: State, md: string | undefined): string[] {
  return [...prdProblems(md), ...prdLinearIssues(s, md)];
}

export interface Ready {
  kind: 'prd';
  file: string;
  summary: string;
}

const firstSentence = (text = '') => (text.replace(/\s+/g, ' ').trim().match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text.trim());

function prdSummary(md: string): string {
  const sec = sections(md);
  const reqs = (sec.get('requirements') ?? '').split('\n').filter((l) => /\bFR-\d+\b/.test(l)).map((l) => `- ${l.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, '').split(/Check:/)[0].trim()}`);
  return [firstSentence(sec.get('problem')), '', '**Requirements**', ...reqs, '', '**Non-goals**', sec.get('non-goals') ?? ''].join('\n').trim();
}

/** The approach a foundational plan chose, from the first line of `## Approaches considered`. */
const chosenApproach = (planMd: string | undefined): string | undefined => {
  const lines = (sections(planMd ?? '').get('approaches considered') ?? '').replace(/<!--[\s\S]*?-->/g, '').split('\n').map((x) => x.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean);
  return lines.find((x) => /^chosen\b/i.test(x)) ?? lines[0];
};

function planSummary(s: State, planMd?: string, cfg?: Config): string {
  // Only a foundational plan's card names the approach: the user approves it with the plan.
  let foundational = false;
  try {
    foundational = isFoundational(s.linear, cfg ? linearConfig(cfg) : undefined);
  } catch {
    // A bad Linear setting shows as a status warning; the card still shows.
  }
  const approach = foundational ? chosenApproach(planMd) : undefined;
  return (approach ? `**Approach:** ${approach}\n\n` : '') + doneWhen(s) + s.phases
    .flatMap((ph, i) => [`${i + 1}. **${ph.name}**`, ...ph.tasks.map((t) => `   - ${t.name} (${t.complexity})${t.risky ? ' risky' : ''}`)])
    .join('\n');
}

/** The plan card's end state: the proofs that lock with this approval. */
function doneWhen(s: State): string {
  const ep = s.endProofs;
  if (!ep?.list.length) return '';
  const lines = ep.list.map((p) => `- ${p.id} (${p.covers.join(', ')}): \`${p.run}\`${p.shots?.length ? `; screenshots judged: ${p.look}` : ''}${p.expect === 'pass' ? ' (guard, already green)' : ''}`);
  const np = ep.notProvable.map((n) => `- ${n.id}: not provable by a run (${n.reason})`);
  return ['**Done when these pass** (locked at this approval; the build runs until they do):', ...lines, ...np, '', ''].join('\n');
}

/** True when prd.md no longer matches the text the user approved. */
export function prdEditedSinceApproval(s: State, prd: string | undefined): boolean {
  return !!s.approvals.prd?.hash && !!prd && hashText(prd) !== s.approvals.prd.hash;
}

const PRD_EDITED_NOTE = '**prd.md changed after you approved it. Until you approve it again, the pull request stays a draft.**';

// Steps during which the stop's document is still being written or checked (or the plan waits on a question about it), so it is not ready yet.
const WRITING_STEPS = ['drafting', 'checking', 'recording', 'asking'];

/** The stop the plan is waiting on, when approving it now would pass its checks. Never throws. */
export const readyFor = (pc: PlanCtx): Ready | undefined => readyCheck(pc).ready;

/**
 * `readyFor`, plus why the check itself failed. The checks here mirror `cmdApprove`'s gates; a check that throws
 * means "not ready", and `error` carries the reason so the pane and menu can say it instead of a bare refusal.
 */
export function readyCheck(pc: PlanCtx): { ready?: Ready; error?: string } {
  try {
    const s = loadState(pc.plan.dir);
    const file = (name: string) => join(pc.plan.dir, name);
    const ready = (r: Ready | undefined) => ({ ready: r });
    // An edited PRD waits on the user at any stage: it is the only way the goal changes.
    if (s.approvals.prd && s.stage !== 'closed') {
      const md = readText(file('prd.md'));
      if (!prdEditedSinceApproval(s, md) || !md || prdApprovalProblems(s, md).length) return {};
      return ready({ kind: 'prd', file: file('prd.md'), summary: `${PRD_EDITED_NOTE}\n\n${prdSummary(md)}` });
    }
    if (s.step?.stage === s.stage && WRITING_STEPS.includes(s.step.name)) return {};
    if (s.stage === 'prd' && !s.approvals.prd) {
      const md = readText(file('prd.md'));
      return ready(md && !prdApprovalProblems(s, md).length ? { kind: 'prd', file: file('prd.md'), summary: prdSummary(md) } : undefined);
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  return {};
}

const APPROVE_USAGE = 'usage: cairn approve prd [--human] [--note "…"]';
const REMOVED_KINDS: Record<string, string> = {
  plan: 'the plan needs no approval: once the PRD is approved cairn writes the plan and the proofs and builds (cairn advance)',
  ship: 'the ship needs no approval: cairn opens the pull request (cairn pr open) and the user merging it is the sign-off',
  commands: 'changed commands need no approval: cairn records the change and the pull request lists it',
};

/** The one approval: the PRD, which fixes the goal. Given again at any later stage when prd.md was edited since. */
export function cmdApprove(ctx: Ctx, kind: string | undefined, opts: Opts, io?: ProofIO): Result {
  if (kind && REMOVED_KINDS[kind]) throw new Refusal(REMOVED_KINDS[kind]);
  if (kind !== 'prd') throw new CliError(APPROVE_USAGE);
  const pc = planCtx(ctx);
  const source = requireHumanProof(kind, opts, io);
  const md = readText(planFile(pc, 'prd.md'));
  return mutate(pc, 'PRD approved', (s) => {
    const again = !!s.approvals.prd;
    gate(again ? prdEditedSinceApproval(s, md) && s.stage !== 'closed' : s.stage === 'prd', s, 'approve prd', opts, again ? 'prd.md has not changed since it was approved' : `the plan is in ${s.stage}, not prd`);
    const problems = prdProblems(md);
    gate(!problems.length, s, 'approve prd', opts, problems.join('; '), ['finish prd.md, resolving open questions with the user']);
    linearPrdGate(s, md, opts);
    s.approvals.prd = { at: now(), via: 'human' as const, source, ...(opts.note ? { note: String(opts.note) } : {}), hash: md ? hashText(md) : undefined };
    log(s, again ? 'PRD edits approved' : 'PRD approved', source);
    if (md) (again ? recordRequirements(s, md) : onPrdApproved(pc, s, md));
    if (again) return { message: 'PRD edits approved. Build toward them: re-plan if the tasks changed (cairn plan load --replan), then carry on.' };
    return { message: 'PRD approved. From here the run is hands-off: `cairn advance`, then plan, build, check, review and open the pull request without stopping.' };
  });
}

const PROOF_FIX = 'cairn prove (and judge any screenshots), fixing until every proof is green';

/**
 * Plan to build, with no approval: the plan and proofs are cairn's. The proofs lock here: they are the end state, so
 * from now builders may add proofs, never edit or remove one.
 */
function lockPlan(pc: PlanCtx, s: State, opts: Opts): void {
  const md = readText(planFile(pc, 'plan.md'));
  gate(s.phases.length > 0, s, 'advance', opts, 'no plan is loaded', ['cairn plan load']);
  gate(!!md && s.planHash === hashText(md), s, 'advance', opts, 'plan.md changed since it was loaded', ['cairn plan load']);
  linearPrdGate(s, readText(planFile(pc, 'prd.md')), opts);
  const unproved = proofApprovalProblems(pc, s);
  gate(!unproved.length, s, 'advance', opts, unproved.join('; '), ['write or fix the proofs (procedures/plan.md, the proofs step), cairn plan load, then cairn prove']);
  for (const p of s.endProofs?.list ?? []) p.lock ??= filesHash(pc.plan.worktree, p.files);
  s.approvals.plan = { at: now(), via: 'agent', hash: s.planHash };
  log(s, 'plan locked', `${s.phases.length} phases, ${s.endProofs?.list.length ?? 0} proofs`);
}

export function cmdAdvance(ctx: Ctx, opts: Opts): Result {
  const pc = planCtx(ctx);
  const decisions = readText(planFile(pc, 'decisions.md')) ?? '';
  const pre = loadState(pc.plan.dir);
  // Advancing a fix plan from ship closes it, with the close checks. Tests run before the lock: they can be slow.
  const closing = fastLane(pre) && pre.stage === 'ship';
  const record = closing ? recordCheck(pc, 'fix') : undefined;
  const tests = closing ? (suiteGreenAtHead(pc) ? reusedRun(pc.cfg) : runTests(pc.cfg, pc.plan.worktree)) : undefined;
  const followups: FollowupInfo[] | undefined = closing && pre.linear ? followupsFor(pc, pre.slug) : undefined;
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
        lockPlan(pc, s, opts);
        break;
      case 'execute':
        gate(s.phases.every((p) => p.status === 'done'), s, 'advance', opts, 'not every phase is finished', ['cairn phase finish']);
        break;
      case 'verify':
        gate(s.evidence.verify?.result === 'pass', s, 'advance', opts, 'verification has not passed', ['cairn evidence verify pass --note "…"']);
        {
          const proofs = proofProblems(pc, s);
          gate(!proofs.length, s, 'advance', opts, `the proofs do not show the end state: ${proofs.join('; ')}`, ['cairn prove (and judge any screenshots), fixing until every proof is green'], 'what');
        }
        break;
      case 'review':
        gate(s.evidence.review?.result === 'pass' && !s.evidence.review.blocking, s, 'advance', opts, 'review has not passed with zero blocking findings', ['fix the blocking findings, re-review, then cairn evidence review pass --blocking 0'], 'what');
        break;
      case 'ship':
        gate(!!s.pullRequest, s, 'advance', opts, 'the pull request is not open', ['cairn pr open']);
        if (record) closeGates(pc, s, opts, record, tests);
        break;
    }
    // An MVP task that was not flagged risky skipped its per-task review: say so, scoped to the task.
    if (to === 'ship' && levelOf(s) === 'mvp')
      for (const t of allTasks(s))
        if (t.status === 'done' && t.level === 'mvp' && !t.risky) addHardening(s, { area: 'quality', text: `Task "${t.name}" ran at MVP without a per-task review.`, where: t.scope });
    const from = s.stage;
    setStage(s, to);
    onAdvance(pc, s, from, to, opts, followups);
    if (to === 'execute') {
      const p = currentPhase(s);
      if (p && p.status === 'pending') p.status = 'in_progress';
    }
    log(s, 'advanced', to);
    if (to === 'closed') return { message: `Closed "${s.title}". The record is ${join(pc.plan.dir, 'RECORD.md')}.` };
    return { message: `Moved to ${to}. ${nextFor(s).text}` };
  });
  if (pc.cfg.autoCommit) commitPath(pc.plan.worktree, planRelOf(pc.plan), `cairn(${pc.plan.slug}): advance to ${to}`);
  return to === 'closed' ? closeMemory(pc, r) : r;
}

export function cmdClose(ctx: Ctx, opts: Opts): Result {
  const pc = planCtx(ctx);
  const record = recordCheck(pc, 'feature');
  const tests = suiteGreenAtHead(pc) ? reusedRun(pc.cfg) : runTests(pc.cfg, pc.plan.worktree);
  const pre = loadState(pc.plan.dir);
  const followups = pre.linear ? followupsFor(pc, pre.slug) : [];
  const r = mutate(pc, 'closed', (s) => {
    gate(s.stage === 'learn', s, 'close', opts, `the plan is in ${s.stage}, not learn`);
    closeGates(pc, s, opts, record, tests);
    setStage(s, 'closed');
    onAdvance(pc, s, 'learn', 'closed', opts, followups);
    log(s, 'closed');
    return { message: `Closed "${s.title}". The record is ${join(pc.plan.dir, 'RECORD.md')}.` };
  });
  return closeMemory(pc, r);
}
