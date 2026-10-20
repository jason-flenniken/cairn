import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { loadConfig, worktreeRoot } from './config.ts';
import { branchExists, commitPath, commonDir, git, gitOk, worktrees } from './git.ts';
import { matchesAny } from './glob.ts';
import { context, planBranch, planRef, planRel, requirePlan, sliceBranch, type Ctx, type PlanRef } from './locate.ts';
import { mergeProgress, parsePlan, phaseStatus } from './plan-parse.ts';
import { allSlices, currentPhase, findSlice, readySet } from './ready.ts';
import { nextFor, renderIndex, summary, type IndexRow } from './render.ts';
import {
  emptySections,
  HANDOFF_SECTIONS,
  missingSections,
  PRD_SECTIONS,
  RECORD_SECTIONS,
  RECORD_WORD_BUDGET,
  sections,
  uncheckedItems,
  wordCount,
} from './sections.ts';
import { loadState, log, newState, parseState, saveState } from './state.ts';
import { STAGES, SUBSTEPS, type Config, type Stage, type State, type Substep } from './types.ts';
import { CliError, hashText, now, pluginRoot, readText, Refusal, SLUG, withLock, writeText } from './util.ts';

export interface Opts {
  json?: boolean;
  override?: string;
  note?: string;
  [k: string]: string | boolean | undefined;
}

export interface Result {
  message: string;
  data?: Record<string, unknown>;
}

const MAX_FIX_ROUNDS = 5;

// ---------- helpers ----------

/** Refuse unless the condition holds; an override lets it through and is logged. */
function gate(ok: boolean, s: State, event: string, opts: Opts, message: string, fixes: string[] = []): void {
  if (ok) return;
  if (opts.override) {
    log(s, `override: ${event}`, message, opts.override);
    return;
  }
  throw new Refusal(message, [...fixes, `or, if the user chose to skip this: add --override "<reason>"`]);
}

interface PlanCtx {
  ctx: Ctx;
  plan: Required<PlanRef>;
  cfg: Config;
}

function planCtx(ctx: Ctx): PlanCtx {
  const plan = requirePlan(ctx);
  return { ctx, plan, cfg: loadConfig(plan.worktree, ctx.mainRoot) };
}

/** Locked read-modify-write of state, then an optional commit of the plan dir. */
function mutate<T>(pc: PlanCtx, commitMsg: string | undefined, fn: (s: State) => T): T {
  const r = withLock(pc.plan.dir, () => {
    const s = loadState(pc.plan.dir);
    const out = fn(s);
    saveState(pc.plan.dir, s);
    return out;
  });
  if (commitMsg && pc.cfg.autoCommit) commitPath(pc.plan.worktree, planRel(pc.plan.slug), `cairn(${pc.plan.slug}): ${commitMsg}`);
  return r;
}

const planFile = (pc: PlanCtx, name: string) => join(pc.plan.dir, name);
const via = (opts: Opts): 'agent' | 'human' => (opts.via === 'human' ? 'human' : 'agent');

interface TestRun {
  ok: boolean;
  cmd: string;
  tail: string;
}

function runTests(cfg: Config, cwd: string): TestRun | undefined {
  if (!cfg.test) return undefined;
  const r = spawnSync('sh', ['-c', cfg.test], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lines = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').map((l) => l.trim()).filter(Boolean);
  return { ok: r.status === 0, cmd: cfg.test, tail: lines.slice(-1)[0] ?? `exit ${r.status}` };
}

/** Refuse (or log an override) when the tests failed or don't exist. Tests run before the state lock is taken. */
function testsGate(t: TestRun | undefined, s: State, event: string, opts: Opts): TestRun | undefined {
  if (!t) {
    gate(false, s, event, opts, 'no test command configured', ['add "test": "<command>" to .sdlc/config.json']);
    return undefined;
  }
  gate(t.ok, s, event, opts, `tests are not green (\`${t.cmd}\` → ${t.tail})`, ['fix the failing tests, then retry']);
  return t;
}

/** Prepare a fresh worktree; failure is reported, not fatal. */
function runSetup(cfg: Config, wt: string, mainRoot: string): string {
  if (!cfg.setup) return '';
  const r = spawnSync('sh', ['-c', cfg.setup], { cwd: wt, encoding: 'utf8', env: { ...process.env, CAIRN_MAIN_ROOT: mainRoot }, maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? `\nSetup ran: ${cfg.setup}` : `\nSetup failed (\`${cfg.setup}\`, exit ${r.status}): ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`;
}

function docProblems(md: string | undefined, file: string, required: readonly string[]): string[] {
  if (md === undefined) return [`${file} does not exist`];
  const p: string[] = [];
  const missing = missingSections(md, required);
  if (missing.length) p.push(`${file} is missing sections: ${missing.join(', ')}`);
  const empty = emptySections(md, required);
  if (empty.length) p.push(`${file} has empty sections: ${empty.join(', ')}`);
  return p;
}

function recordProblems(pc: PlanCtx): string[] {
  const md = readText(planFile(pc, 'RECORD.md'));
  const p = docProblems(md, 'RECORD.md', RECORD_SECTIONS);
  if (md && wordCount(md) > RECORD_WORD_BUDGET) p.push(`RECORD.md is ${wordCount(md)} words; the budget is ${RECORD_WORD_BUDGET}`);
  return p;
}

const STAGE_ORDER: Stage[] = [...STAGES];
const nextStage = (s: Stage): Stage | undefined => STAGE_ORDER[STAGE_ORDER.indexOf(s) + 1];

function ensureExcluded(mainRoot: string, pattern: string): void {
  const file = join(commonDir(mainRoot), 'info', 'exclude');
  const cur = readText(file) ?? '';
  if (!cur.split('\n').includes(pattern)) {
    mkdirSync(join(commonDir(mainRoot), 'info'), { recursive: true });
    appendFileSync(file, `${cur.endsWith('\n') || !cur ? '' : '\n'}${pattern}\n`);
  }
}

function template(name: string): string | undefined {
  try {
    return readText(join(pluginRoot(), 'templates', name));
  } catch {
    return undefined;
  }
}

// ---------- plans ----------

export function cmdNew(ctx: Ctx, slug: string | undefined, opts: Opts): Result {
  if (!slug || !SLUG.test(slug)) throw new CliError('usage: cairn new <kebab-case-slug> --title "…"');
  const branch = planBranch(slug);
  if (branchExists(branch, ctx.top)) throw new Refusal(`a plan named "${slug}" already exists (${branch})`, [`cairn resume ${slug}`, 'or pick another slug']);
  if (!gitOk(['rev-parse', '--verify', 'HEAD'], ctx.top)) throw new Refusal('the repository has no commits yet', ['make an initial commit first']);
  const mainBranch = ctx.worktrees[0]?.branch ?? ctx.branch;
  const base = typeof opts.from === 'string' ? opts.from : ctx.plan ? mainBranch : ctx.branch;
  const title = typeof opts.title === 'string' ? opts.title : slug;
  const track = opts.track === 'fix' ? 'fix' : 'feature';
  const cfg = loadConfig(ctx.top, ctx.mainRoot);

  let wt: string;
  if (opts['no-worktree']) {
    git(['switch', '-q', '-c', branch, base], ctx.top);
    wt = ctx.top;
  } else {
    const root = worktreeRoot(cfg, ctx.mainRoot);
    if (!cfg.worktreeRoot) ensureExcluded(ctx.mainRoot, '.claude/worktrees/');
    wt = join(root, `sdlc-${slug}`);
    git(['worktree', 'add', '-q', '-b', branch, wt, base], ctx.top);
  }
  const dir = join(wt, planRel(slug));
  writeText(join(dir, 'decisions.md'), `# Decisions: ${title}\n\nAppend-only. Written by \`cairn decide\` as each decision is made.\n`);
  saveState(dir, newState(slug, title, track, branch, base));
  if (cfg.autoCommit) commitPath(wt, planRel(slug), `cairn(${slug}): start plan "${title}"`);
  const setup = opts['no-worktree'] ? '' : runSetup(cfg, wt, ctx.mainRoot);
  return {
    message: [
      `Started plan "${title}" on ${branch} (from ${base}).${setup}`,
      `Worktree: ${wt}`,
      `Next: switch into the worktree (EnterWorktree with path ${wt}, or \`cd ${wt} && claude\`), then run /cairn:next.`,
    ].join('\n'),
    data: { slug, branch, base, worktree: wt, dir },
  };
}

export function cmdProductInit(ctx: Ctx): Result {
  const dir = join(ctx.top, 'docs/sdlc/product');
  const prd = join(dir, 'PRD.md');
  if (existsSync(prd)) throw new Refusal('docs/sdlc/product/PRD.md already exists', ['edit it with the product procedure instead']);
  writeText(prd, template('product-prd.md') ?? '# Product PRD\n\n## Vision\n\n## Users\n\n## Non-goals\n\n## Non-functional requirements\n\n## Must not trade off\n\n## Roadmap\n');
  writeText(join(dir, 'decisions', '.gitkeep'), '');
  return { message: `Created docs/sdlc/product/PRD.md and decisions/ on ${ctx.branch}. Fill it in, then commit.`, data: { path: prd } };
}

export function cmdDecide(ctx: Ctx, question: string | undefined, answer: string | undefined, opts: Opts): Result {
  if (!question || !answer) throw new CliError('usage: cairn decide "<question>" "<answer>" [--why "…"]');
  const pc = planCtx(ctx);
  const file = planFile(pc, 'decisions.md');
  const cur = readText(file) ?? '# Decisions\n';
  const n = (cur.match(/^### /gm)?.length ?? 0) + 1;
  const why = typeof opts.why === 'string' ? `\n**Why:** ${opts.why}` : '';
  writeText(file, `${cur.replace(/\n*$/, '\n')}\n### ${n}. ${question}\n**Decision:** ${answer}${why}\n_${now().slice(0, 16).replace('T', ' ')}_\n`);
  return { message: `Recorded decision ${n}: ${answer}`, data: { number: n } };
}

// ---------- stages ----------

export function cmdApprove(ctx: Ctx, kind: string | undefined, opts: Opts): Result {
  const pc = planCtx(ctx);
  const approval = () => ({ at: now(), via: via(opts), ...(opts.note ? { note: String(opts.note) } : {}) });
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
        log(s, 'PRD approved', s.approvals.prd.via);
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
        log(s, 'plan approved', s.approvals.plan.via);
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
        log(s, 'phase approved', phase.name);
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
        log(s, 'ship approved', s.approvals.ship.via);
        return { message: 'Ship approved. Next: open the PR, then `cairn advance`.' };
      });
    default:
      throw new CliError('usage: cairn approve prd|plan|phase|ship [--note "…"]');
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
    const { phases, lostDone } = mergeProgress(parsed.phases, s.phases);
    if (lostDone.length) throw new Refusal(`the new plan drops slices that already started or finished: ${lostDone.join(', ')}`, ['keep them in plan.md']);
    s.phases = phases;
    s.planHash = hashText(planMd);
    if (replanning) {
      s.stage = 'plan';
      delete s.approvals.plan;
      delete s.evidence.verify;
      delete s.evidence.review;
      log(s, 're-plan loaded', `${allSlices(s).length} slices`);
    } else log(s, 'plan loaded', `${s.phases.length} phases, ${allSlices(s).length} slices`);
    return {
      message: `Loaded ${s.phases.length} phases and ${allSlices(s).length} slices.${replanning ? ' The plan needs approval again.' : ''} Next: approve the plan with the user.`,
      data: { phases: s.phases.map((p) => ({ id: p.id, name: p.name, slices: p.slices.map((x) => x.id) })) },
    };
  });
}

// ---------- slices ----------

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
    if (sl.status === 'done') throw new Refusal(`slice "${sl.name}" is already done`);
    gate(s.stage === 'execute' && !s.paused, s, 'slice start', opts, s.paused ? 'the plan is paused' : `the plan is in ${s.stage}, not execute`);
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
  // Evidence is gathered before taking the lock: tests can be slow.
  const merged = branchExists(sl.branch, plan.worktree) && gitOk(['merge-base', '--is-ancestor', sl.branch, pb], plan.worktree);
  const dirty = sl.worktree && existsSync(sl.worktree) ? git(['status', '--porcelain'], sl.worktree) : '';
  const tip = branchExists(sl.branch, plan.worktree) ? git(['rev-parse', '--short', sl.branch], plan.worktree) : undefined;
  const commits = tip && sl.base ? Number(git(['rev-list', '--count', `${sl.base}..${sl.branch}`], plan.worktree)) : 0;
  const planDirty = git(['status', '--porcelain', '--', '.', `:!${planRel(plan.slug)}`], plan.worktree);
  const tests = merged && !dirty && !planDirty ? runTests(pc.cfg, plan.worktree) : undefined;
  const r = mutate(pc, `slice done: ${sl.name}`, (s) => {
    const cur = findSlice(s, id)!;
    gate(!dirty, s, 'slice done', opts, `the slice worktree has uncommitted changes`, [`commit or discard them in ${cur.worktree}`]);
    gate(commits > 0, s, 'slice done', opts, `${cur.branch} has no commits since the slice started`, ['the implementer commits its work on the slice branch, in the slice worktree']);
    gate(!planDirty, s, 'slice done', opts, `the plan worktree has uncommitted changes outside docs/sdlc: ${planDirty.split('\n').slice(0, 5).join(', ')}`, ['work belongs on slice branches: move it into a slice, or discard it']);
    gate(merged, s, 'slice done', opts, `${cur.branch} is not merged into ${pb}`, [`git -C ${plan.worktree} merge --no-ff ${cur.branch}`]);
    testsGate(tests ?? (merged && !dirty && !planDirty ? undefined : { ok: false, cmd: pc.cfg.test ?? '(none)', tail: 'not run' }), s, 'slice done', opts);
    Object.assign(cur, { status: 'done', substep: undefined, doneAt: now(), tip, tests: tests ? `${tests.cmd} → ${tests.tail}` : undefined });
    const phase = s.phases.find((p) => p.slices.some((x) => x.id === id))!;
    phase.status = phaseStatus(phase, phase.status);
    log(s, 'slice done', cur.name);
    const left = phase.slices.filter((x) => x.status !== 'done').length;
    return {
      message: `Slice "${cur.name}" done${tests ? ` (tests: ${tests.tail})` : ''}. ${left ? `${left} slice(s) left in phase "${phase.name}".` : `Phase "${phase.name}" is built: run the phase-end review.`}`,
      data: { phaseComplete: !left },
    };
  });
  // Clean up the slice worktree and branch once its work is in the plan branch.
  if (merged && sl.worktree && existsSync(sl.worktree)) gitOk(['worktree', 'remove', sl.worktree], plan.worktree);
  if (merged) gitOk(['branch', '-d', sl.branch], plan.worktree);
  return r;
}

// ---------- evidence, drift ----------

export function cmdEvidence(ctx: Ctx, kind: string | undefined, result: string | undefined, opts: Opts): Result {
  if ((kind !== 'verify' && kind !== 'review') || (result !== 'pass' && result !== 'fail'))
    throw new CliError('usage: cairn evidence verify|review pass|fail [--note "…"] [--blocking N]');
  const pc = planCtx(ctx);
  return mutate(pc, `${kind} ${result}`, (s) => {
    gate(s.stage === kind, s, `evidence ${kind}`, opts, `the plan is in ${s.stage}, not ${kind}`);
    const blocking = opts.blocking !== undefined ? Number(opts.blocking) : undefined;
    if (result === 'pass' && blocking) throw new Refusal(`a review with ${blocking} blocking finding(s) can't pass`, ['turn them into fix slices (cairn plan load --replan) or record fail']);
    s.evidence[kind] = { result, at: now(), ...(opts.note ? { note: String(opts.note) } : {}), ...(blocking !== undefined ? { blocking } : {}) };
    log(s, `${kind} ${result}`, opts.note ? String(opts.note) : undefined);
    return { message: `Recorded ${kind}: ${result}.` };
  });
}

export function cmdDriftAck(ctx: Ctx, path: string | undefined, opts: Opts): Result {
  if (!path && !opts.all) throw new CliError('usage: cairn drift ack <path>|--all [--note "…"]');
  const pc = planCtx(ctx);
  return mutate(pc, undefined, (s) => {
    const hits = s.drift.filter((d) => !d.acked && (opts.all || d.path === path));
    if (!hits.length) throw new Refusal(`no unreviewed drift${path ? ` for ${path}` : ''}`);
    for (const d of hits) d.acked = { at: now(), ...(opts.note ? { note: String(opts.note) } : {}) };
    log(s, 'drift reviewed', hits.map((d) => d.path).join(', '));
    return { message: `Marked ${hits.length} drift entr${hits.length === 1 ? 'y' : 'ies'} as reviewed.` };
  });
}

// ---------- pause, resume, close ----------

export function cmdPause(ctx: Ctx, opts: Opts): Result {
  const pc = planCtx(ctx);
  const md = readText(planFile(pc, 'handoff.md'));
  return mutate(pc, 'paused', (s) => {
    if (s.stage === 'closed') throw new Refusal('the plan is closed');
    if (s.paused) throw new Refusal('the plan is already paused', ['cairn resume']);
    const problems = docProblems(md, 'handoff.md', HANDOFF_SECTIONS);
    const hash = md ? hashText(md) : undefined;
    const lastHash = [...s.log].reverse().find((l) => l.event === 'paused')?.detail;
    if (hash && hash === lastHash) problems.push('handoff.md is unchanged since the last pause');
    gate(!problems.length, s, 'pause', opts, problems.join('; '), ['write handoff.md from templates/handoff.md: what is in flight, open questions, the next action']);
    s.paused = { at: now(), mode: opts.now ? 'now' : 'drain', handoffHash: hash };
    log(s, 'paused', hash);
    return { message: `Paused "${s.title}". To pick up later: open Claude Code in this worktree and run /cairn:next (or /cairn:resume ${s.slug} from main).` };
  });
}

export function cmdResume(ctx: Ctx, slug: string | undefined, opts: Opts): Result {
  if (slug && ctx.plan?.slug !== slug) {
    const ref = planRef(slug, ctx.worktrees);
    if (!branchExists(planBranch(slug), ctx.top)) throw new Refusal(`no plan named "${slug}"`, ['cairn status --all']);
    if (!ref.worktree) {
      const cfg = loadConfig(ctx.top, ctx.mainRoot);
      const wt = join(worktreeRoot(cfg, ctx.mainRoot), `sdlc-${slug}`);
      git(['worktree', 'add', '-q', wt, planBranch(slug)], ctx.top);
      ensureExcluded(ctx.mainRoot, '.claude/worktrees/');
      ref.worktree = wt;
    }
    return {
      message: `Plan "${slug}" lives in ${ref.worktree}. Switch into it (EnterWorktree with that path, or \`cd ${ref.worktree} && claude\`), then run /cairn:resume.`,
      data: { slug, worktree: ref.worktree, switchRequired: true },
    };
  }
  const pc = planCtx(ctx);
  const wasPaused = !!loadState(pc.plan.dir).paused;
  const r = mutate(pc, wasPaused ? 'resumed' : undefined, (s) => {
    if (s.paused) {
      log(s, 'resumed', `paused since ${s.paused.at.slice(0, 10)}`);
      s.paused = null;
    }
    const next = nextFor(s);
    const running = allSlices(s).filter((x) => x.status === 'in_progress');
    return {
      message: [
        wasPaused ? `Resumed "${s.title}".` : `"${s.title}" was not paused.`,
        summary(s),
        ...running.map((x) => `  in flight: ${x.name} (${x.substep}${x.fixRound ? `, fix round ${x.fixRound}` : ''}) at ${x.worktree}`),
        `Next: ${next.text}`,
      ].join('\n'),
      data: { procedure: procedurePath(next.procedure), handoff: readText(planFile(pc, 'handoff.md')) ?? null },
    };
  });
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

// ---------- status, next, render ----------

export function listPlans(ctx: Ctx): IndexRow[] {
  const refs = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/sdlc/'], ctx.top).split('\n').filter(Boolean);
  const rows: IndexRow[] = [];
  for (const b of refs) {
    const slug = b.slice('sdlc/'.length);
    const ref = planRef(slug, ctx.worktrees);
    try {
      const raw = ref.dir && existsSync(join(ref.dir, 'state.json')) ? readFileSync(join(ref.dir, 'state.json'), 'utf8') : git(['show', `${b}:${planRel(slug)}/state.json`], ctx.top);
      rows.push({ state: parseState(raw), live: !!ref.dir, worktree: ref.worktree });
    } catch {
      // A branch without plan state is not a cairn plan.
    }
  }
  return rows;
}

function warnings(pc: PlanCtx, s: State): string[] {
  const w: string[] = [];
  const prd = readText(planFile(pc, 'prd.md'));
  if (s.approvals.prd?.hash && prd && hashText(prd) !== s.approvals.prd.hash) w.push('prd.md changed after it was approved');
  const plan = readText(planFile(pc, 'plan.md'));
  if (s.planHash && plan && hashText(plan) !== s.planHash) w.push('plan.md changed after it was loaded: run `cairn plan load --replan` or revert it');
  const open = s.drift.filter((d) => !d.acked);
  if (open.length) w.push(`${open.length} file(s) changed outside the plan's scope`);
  return w;
}

export function cmdStatus(ctx: Ctx, opts: Opts): Result {
  if (opts.all || !ctx.plan) {
    const rows = listPlans(ctx);
    const active = rows.filter((r) => r.state.stage !== 'closed');
    const lines = rows.length
      ? rows.map((r) => `${r.state.stage === 'closed' ? '✓' : r.state.paused ? '⏸' : '•'} ${summary(r.state)}\n    next: ${nextFor(r.state).text}${r.worktree ? '' : ' (not checked out)'}`)
      : ['No plans yet. Start one with /cairn:new.'];
    return { message: `${active.length} active plan(s).\n${lines.join('\n')}`, data: { plans: rows.map((r) => ({ ...r, next: nextFor(r.state) })) } };
  }
  const pc = planCtx(ctx);
  const s = loadState(pc.plan.dir);
  const w = warnings(pc, s);
  const next = nextFor(s);
  return {
    message: [summary(s), `Next: ${next.text}`, ...w.map((x) => `! ${x}`), ...(ctx.slice ? [`(You are in the worktree for slice "${ctx.slice}".)`] : [])].join('\n'),
    data: { state: s, next, warnings: w, slice: ctx.slice ?? null, planWorktree: pc.plan.worktree },
  };
}

export const procedurePath = (name: string) => join(pluginRoot(), 'procedures', `${name}.md`);

export function cmdNext(ctx: Ctx): Result {
  if (!ctx.plan) {
    const active = listPlans(ctx).filter((r) => r.state.stage !== 'closed');
    if (!active.length) return { message: 'No active plans. Start one.', data: { plan: null, stage: null, procedure: procedurePath('new'), summary: 'No active plans.' } };
    return {
      message: `Active plans:\n${active.map((r) => `  ${summary(r.state)}`).join('\n')}\nAsk the user which plan to resume (/cairn:resume <slug>) or whether to start a new one (/cairn:new).`,
      data: { plan: null, stage: null, procedure: procedurePath('status'), plans: active.map((r) => r.state.slug) },
    };
  }
  const pc = planCtx(ctx);
  const s = loadState(pc.plan.dir);
  const n = nextFor(s);
  return {
    message: `${summary(s)}\nNext: ${n.text}\nFollow: ${procedurePath(n.procedure)}`,
    data: { plan: s.slug, stage: s.stage, substep: n.substep ?? null, procedure: procedurePath(n.procedure), summary: summary(s), text: n.text, warnings: warnings(pc, s), planWorktree: pc.plan.worktree },
  };
}

export function cmdRender(ctx: Ctx): Result {
  if (ctx.plan) {
    const pc = planCtx(ctx);
    withLock(pc.plan.dir, () => saveState(pc.plan.dir, loadState(pc.plan.dir)));
    return { message: `Rendered ${join(pc.plan.dir, 'STATUS.md')}.` };
  }
  const out = join(ctx.top, 'docs/sdlc/INDEX.md');
  writeText(out, renderIndex(listPlans(ctx)));
  return { message: `Rendered ${out}.` };
}

// ---------- hooks ----------

interface HookInput {
  cwd?: string;
  tool_input?: { file_path?: string; notebook_path?: string };
}

const hookOut = (event: string, text: string) => JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });

export function hookSessionStart(input: HookInput): string {
  const ctx = context(input.cwd ?? process.cwd());
  if (ctx.plan?.dir && existsSync(join(ctx.plan.dir, 'state.json'))) {
    const pc = planCtx(ctx);
    const s = loadState(pc.plan.dir);
    if (s.stage === 'closed') return '';
    const lines = [`cairn: ${summary(s)}`, `Next: ${nextFor(s).text} The user runs /cairn:next to continue.`, ...warnings(pc, s).map((w) => `Warning: ${w}`)];
    if (ctx.slice) {
      const sl = findSlice(s, ctx.slice);
      if (sl) lines.push(`This worktree is slice "${sl.name}". Touch only: ${sl.scope.join(', ')}. Never edit docs/sdlc/.`);
    }
    return hookOut('SessionStart', lines.join('\n'));
  }
  const active = listPlans(ctx).filter((r) => r.state.stage !== 'closed');
  if (!active.length) return '';
  return hookOut('SessionStart', [`cairn: ${active.length} active plan(s) in this repo:`, ...active.map((r) => `- ${summary(r.state)}`), 'The user can resume one with /cairn:resume <slug> or start another with /cairn:new.'].join('\n'));
}

export function hookPostEdit(input: HookInput): string {
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (!file) return '';
  // Subagents keep the session's cwd but edit by absolute path in their slice worktree,
  // so the worktree (and therefore the plan and slice) comes from the file, not the cwd.
  const abs = isAbsolute(file) ? file : resolve(input.cwd ?? process.cwd(), file);
  let dir = dirname(abs);
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  const ctx = context(dir);
  if (!ctx.plan?.dir || !existsSync(join(ctx.plan.dir, 'state.json'))) return '';
  const rel = relative(ctx.top, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) return '';
  if (rel.startsWith('docs/sdlc/') || rel.startsWith('.sdlc/') || rel.startsWith('.claude/')) return '';
  const pc = planCtx(ctx);
  const logged = withLock(pc.plan.dir, () => {
    const s = loadState(pc.plan.dir);
    if (s.stage === 'closed') return '';
    let allowed: string[];
    let where: string;
    const slice = ctx.slice ? findSlice(s, ctx.slice) : undefined;
    if (['discover', 'prd', 'plan'].includes(s.stage)) {
      allowed = ['docs/**'];
      where = 'before the plan was approved';
    } else if (slice) {
      allowed = slice.scope;
      where = `outside slice "${slice.name}" scope`;
    } else if (s.stage === 'execute') {
      allowed = (currentPhase(s)?.slices ?? []).flatMap((x) => x.scope);
      where = "outside the current phase's scope";
    } else {
      allowed = allSlices(s).flatMap((x) => x.scope);
      where = "outside the plan's scope";
    }
    if (matchesAny(rel, allowed)) return '';
    if (s.drift.some((d) => d.path === rel && !d.acked)) return '';
    s.drift.push({ path: rel, at: now(), reason: `edited ${where}`, ...(slice ? { slice: slice.id } : {}) });
    log(s, 'drift', rel);
    saveState(pc.plan.dir, s);
    return `${rel} was edited ${where}`;
  });
  return logged ? hookOut('PostToolUse', `cairn: ${logged}. Logged as drift; the user reviews it at the next checkpoint. If this was not intended, revert it.`) : '';
}

export { context };
export const _internal = { runTests, worktrees };
