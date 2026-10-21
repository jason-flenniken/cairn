import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { worktreeRoot } from '../config.ts';
import { branchExists, git, gitOk } from '../git.ts';
import { planBranch, planRel, sliceBranch, type Ctx } from '../locate.ts';
import { phaseStatus } from '../plan-parse.ts';
import { findSlice, readySet } from '../ready.ts';
import { loadState, log } from '../state.ts';
import { SUBSTEPS, type Substep } from '../types.ts';
import { CliError, now, Refusal } from '../util.ts';
import { ensureExcluded, gate, mutate, planCtx, runSetup, runTests, testsGate, type Opts, type PlanCtx, type Result } from '../shared.ts';
import { configGate, fastLane, runRepro } from './fix.ts';

const MAX_FIX_ROUNDS = 5;
const DEFAULT_FIX_MAX_FILES = 8;

export function cmdReady(ctx: Ctx): Result {
  const pc = planCtx(ctx);
  const s = loadState(pc.plan.dir);
  const r = readySet(s, pc.cfg.maxParallel);
  const tier = { simple: 'haiku', standard: 'sonnet', complex: 'opus' } as const;
  const lines = [
    r.phase ? `Phase "${r.phase.name}": ${r.ready.length} ready, ${r.inProgress.length} running, ${r.waiting.length} waiting.` : 'No phase in progress.',
    ...r.ready.map((x) => `  ready: ${x.id} (${x.name}) model=${tier[x.complexity]}`),
    ...r.inProgress.map((x) => `  running: ${x.id} (${x.substep ?? 'implementing'}${x.fixRound ? `, fix round ${x.fixRound}` : ''}) at ${x.worktree}`),
    ...r.waiting.map((w) => `  waiting: ${w.slice.id} on ${w.on.join(', ')}`),
  ];
  if (s.paused) lines.unshift('The plan is paused: start nothing new.');
  return {
    message: lines.join('\n'),
    data: {
      paused: !!s.paused,
      phase: r.phase?.id,
      phaseStatus: r.phase?.status,
      ready: r.ready.map((x) => ({ ...x, model: tier[x.complexity] })),
      inProgress: r.inProgress,
      waiting: r.waiting.map((w) => ({ id: w.slice.id, on: w.on })),
    },
  };
}

export function cmdSlice(ctx: Ctx, action: string | undefined, id: string | undefined, rest: string[], opts: Opts): Result {
  if (!id) throw new CliError('usage: cairn slice start|step|done <slice-id> …');
  const pc = planCtx(ctx);
  if (action === 'start') return sliceStart(pc, id, opts);
  if (action === 'step') return sliceStep(pc, id, rest[0], opts);
  if (action === 'done') return sliceDone(pc, id, opts);
  throw new CliError('usage: cairn slice start|step|done <slice-id>');
}

function sliceStart(pc: PlanCtx, id: string, opts: Opts): Result {
  const { plan, ctx, cfg } = pc;
  const branch = sliceBranch(plan.slug, id);
  const path = join(worktreeRoot(cfg, ctx.mainRoot), `sdlc-${plan.slug}--${id}`);
  const r = mutate(pc, undefined, (s) => {
    const sl = findSlice(s, id);
    if (!sl) throw new Refusal(`no slice "${id}" in this plan`, ['cairn ready']);
    if (sl.status === 'in_progress') return { message: `Slice "${sl.name}" is already running (${sl.substep}) at ${sl.worktree}.`, data: { worktree: sl.worktree, branch: sl.branch, resumed: true } };
    if (sl.status === 'done' && fastLane(s) && s.stage === 'review') {
      // A review finding reopens the fix: back to execute, keeping the repro and the slice base.
      sl.status = 'pending';
      s.phases.find((p) => p.slices.includes(sl))!.status = 'in_progress';
      s.stage = 'execute';
      delete s.evidence.review;
      log(s, 'fix reopened', 'from review');
    }
    if (sl.status === 'done') throw new Refusal(`slice "${sl.name}" is already done`);
    gate(s.stage === 'execute' && !s.paused, s, 'slice start', opts, s.paused ? 'the plan is paused' : `the plan is in ${s.stage}, not execute`);
    configGate(s, cfg, 'slice start', opts);
    const ready = readySet(s, cfg.maxParallel);
    const waiting = ready.waiting.find((w) => w.slice.id === id);
    gate(ready.ready.some((x) => x.id === id), s, 'slice start', opts, waiting ? `slice "${sl.name}" is waiting on ${waiting.on.join(', ')}` : `slice "${sl.name}" is not in the current phase`, ['cairn ready']);
    const base = git(['rev-parse', planBranch(plan.slug)], plan.worktree);
    let setup = '';
    if (!existsSync(path)) {
      if (branchExists(branch, plan.worktree)) git(['worktree', 'add', '-q', path, branch], plan.worktree);
      else git(['worktree', 'add', '-q', '-b', branch, path, planBranch(plan.slug)], plan.worktree);
      setup = runSetup(cfg, path, ctx.mainRoot);
    }
    Object.assign(sl, { status: 'in_progress', substep: 'implementing', fixRound: 0, branch, worktree: path, base: sl.base ?? base });
    const phase = s.phases.find((p) => p.slices.includes(sl))!;
    if (phase.status === 'pending') phase.status = 'in_progress';
    log(s, 'slice started', sl.name);
    return { message: `Started slice "${sl.name}" in ${path} (branch ${branch}).${setup}`, data: { worktree: path, branch, planBranch: planBranch(plan.slug) } };
  });
  ensureExcluded(ctx.mainRoot, '.claude/worktrees/');
  return r;
}

function sliceStep(pc: PlanCtx, id: string, step: string | undefined, opts: Opts): Result {
  if (!SUBSTEPS.includes(step as Substep)) throw new CliError(`usage: cairn slice step <id> ${SUBSTEPS.join('|')}`);
  return mutate(pc, undefined, (s) => {
    const sl = findSlice(s, id);
    if (!sl || sl.status !== 'in_progress') throw new Refusal(`slice "${id}" is not running`, ['cairn slice start ' + id]);
    if (step === 'fixing') {
      gate(sl.fixRound < MAX_FIX_ROUNDS, s, 'slice fix round', opts, `slice "${sl.name}" has used ${MAX_FIX_ROUNDS} fix rounds`, ['stop and ask the user: split the slice, re-plan, or take it over']);
      sl.fixRound++;
    }
    sl.substep = step as Substep;
    if (opts.note) sl.note = String(opts.note);
    log(s, `slice ${step}`, `${sl.name}${step === 'fixing' ? ` (round ${sl.fixRound})` : ''}${opts.note ? `: ${opts.note}` : ''}`);
    return { message: `Slice "${sl.name}": ${step}${step === 'fixing' ? `, round ${sl.fixRound} of ${MAX_FIX_ROUNDS}` : ''}.` };
  });
}

function sliceDone(pc: PlanCtx, id: string, opts: Opts): Result {
  const { plan } = pc;
  const pre = loadState(plan.dir);
  const sl = findSlice(pre, id);
  if (!sl) throw new Refusal(`no slice "${id}" in this plan`);
  if (sl.status !== 'in_progress' || !sl.branch) throw new Refusal(`slice "${sl.name}" is not running`);
  const pb = planBranch(plan.slug);
  // A changed command never runs before the refusal; with --override the in-lock check logs it.
  if (!opts.override) configGate(pre, pc.cfg, 'slice done', opts);
  // Evidence is gathered before taking the lock: tests can be slow.
  const merged = branchExists(sl.branch, plan.worktree) && gitOk(['merge-base', '--is-ancestor', sl.branch, pb], plan.worktree);
  const dirty = sl.worktree && existsSync(sl.worktree) ? git(['status', '--porcelain'], sl.worktree) : '';
  const tip = branchExists(sl.branch, plan.worktree) ? git(['rev-parse', '--short', sl.branch], plan.worktree) : undefined;
  const commits = tip && sl.base ? Number(git(['rev-list', '--count', `${sl.base}..${sl.branch}`], plan.worktree)) : 0;
  const planDirty = git(['status', '--porcelain', '--', '.', `:!${planRel(plan.slug)}`], plan.worktree);
  const checkable = merged && !dirty && !planDirty;
  const tests = checkable ? runTests(pc.cfg, plan.worktree) : undefined;
  // The fix track adds: the repro now passes, and the fix stays small (FR-25). Renames count once.
  const fix = fastLane(pre) && checkable;
  const repro = fix && pre.repro ? runRepro(pre.repro.cmd, plan.worktree, pc.cfg) : undefined;
  const changed = fix && sl.base ? git(['diff', '--name-only', '-M', sl.base, sl.branch, '--', '.', ':!docs/sdlc'], plan.worktree).split('\n').filter(Boolean).length : 0;
  const maxFiles = pc.cfg.fixMaxFiles ?? DEFAULT_FIX_MAX_FILES;
  const r = mutate(pc, `slice done: ${sl.name}`, (s) => {
    const cur = findSlice(s, id)!;
    configGate(s, pc.cfg, 'slice done', opts);
    gate(!dirty, s, 'slice done', opts, `the slice worktree has uncommitted changes`, [`commit or discard them in ${cur.worktree}`]);
    gate(commits > 0, s, 'slice done', opts, `${cur.branch} has no commits since the slice started`, ['the implementer commits its work on the slice branch, in the slice worktree']);
    gate(!planDirty, s, 'slice done', opts, `the plan worktree has uncommitted changes outside docs/sdlc: ${planDirty.split('\n').slice(0, 5).join(', ')}`, ['work belongs on slice branches: move it into a slice, or discard it']);
    gate(merged, s, 'slice done', opts, `${cur.branch} is not merged into ${pb}`, [`git -C ${plan.worktree} merge --no-ff ${cur.branch}`]);
    testsGate(tests ?? (checkable ? undefined : { ok: false, cmd: pc.cfg.test ?? '(none)', tail: 'not run' }), s, 'slice done', opts);
    if (repro) {
      gate(repro.outcome === 'passes', s, 'slice done', opts, `the repro still fails (\`${s.repro!.cmd}\` → ${repro.detail})`, ['fix the bug so the repro command exits 0']);
      gate(changed <= maxFiles, s, 'slice done', opts, `the fix changed ${changed} files; a fix may change at most ${maxFiles}`, ['this is bigger than a fix: cairn escalate turns it into a feature plan, keeping the work']);
    }
    Object.assign(cur, { status: 'done', substep: undefined, doneAt: now(), tip, tests: tests ? `${tests.cmd} → ${tests.tail}` : undefined });
    const phase = s.phases.find((p) => p.slices.some((x) => x.id === id))!;
    phase.status = phaseStatus(phase, phase.status);
    // The fix track has no phase stop: the single phase is done with its slice.
    if (fastLane(s) && phase.status === 'awaiting_approval') phase.status = 'done';
    log(s, 'slice done', cur.name);
    const left = phase.slices.filter((x) => x.status !== 'done').length;
    return {
      message: `Slice "${cur.name}" done${tests ? ` (tests: ${tests.tail})` : ''}. ${left ? `${left} slice(s) left in phase "${phase.name}".` : fastLane(s) ? 'The fix is built: `cairn advance` to review.' : `Phase "${phase.name}" is built: run the phase-end review.`}`,
      data: { phaseComplete: !left },
    };
  });
  // Clean up the slice worktree and branch once its work is in the plan branch.
  if (merged && sl.worktree && existsSync(sl.worktree)) gitOk(['worktree', 'remove', sl.worktree], plan.worktree);
  if (merged) gitOk(['branch', '-d', sl.branch], plan.worktree);
  return r;
}
