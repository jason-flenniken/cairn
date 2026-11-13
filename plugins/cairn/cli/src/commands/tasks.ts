import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { worktreeRoot } from '../config.ts';
import { branchExists, directCommits, git, gitOk, gitTry } from '../git.ts';
import { matchesAny } from '../glob.ts';
import { planRelOf, taskBranch, type Ctx } from '../locate.ts';
import { isCairnPath } from '../paths.ts';
import { phaseStatus } from '../plan-parse.ts';
import { currentPhase, findTask, readySet } from '../ready.ts';
import { loadState, log, setStage } from '../state.ts';
import { SUBSTEPS, type Substep } from '../types.ts';
import { CliError, now, Refusal } from '../util.ts';
import { taskBrief, taskReport, writeBrief } from './brief.ts';
import { ensureExcluded, gate, mutate, planCtx, runSetup, runTests, testsGate, type Opts, type PlanCtx, type Result } from '../shared.ts';
import { changedFiles, configGate, fastLane, runRepro } from './fix.ts';
import { syncTickets } from './linear.ts';
import { linearConfig } from '../linear.ts';

const MAX_FIX_ROUNDS = 2;
const DEFAULT_FIX_MAX_FILES = 8;

export function cmdReady(ctx: Ctx): Result {
  const pc = planCtx(ctx);
  const s = loadState(pc.plan.dir);
  const r = readySet(s, pc.cfg.maxParallel);
  const tier = { simple: 'haiku', standard: 'sonnet', complex: 'opus' } as const;
  const lines = [
    r.phase ? `Phase "${r.phase.name}": ${r.ready.length} ready, ${r.inProgress.length} running, ${r.waiting.length} waiting.` : 'No phase in progress.',
    ...r.ready.map((x) => `  ready: ${x.id} (${x.name}) model=${tier[x.complexity]}`),
    ...r.inProgress.map((x) => `  running: ${x.id} (${x.substep ?? 'implementing'}${x.fixRound ? `, fix attempt ${x.fixRound}` : ''}) at ${x.worktree}`),
    ...r.waiting.map((w) => `  waiting: ${w.task.id} on ${w.on.join(', ')}`),
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
      waiting: r.waiting.map((w) => ({ id: w.task.id, on: w.on })),
    },
  };
}

export function cmdTask(ctx: Ctx, action: string | undefined, id: string | undefined, rest: string[], opts: Opts): Result {
  if (!id) throw new CliError('usage: cairn task start|step|done|merge|brief|report <task-id> …');
  if (action === 'report') return taskReport(ctx, id, rest[0]);
  const pc = planCtx(ctx);
  if (action === 'start') return taskStart(pc, id, opts);
  if (action === 'step') return taskStep(pc, id, rest[0], opts);
  if (action === 'done') return taskDone(pc, id, opts);
  if (action === 'merge') return taskMerge(pc, id, opts);
  if (action === 'brief') return taskBrief(pc, id, opts);
  throw new CliError('usage: cairn task start|step|done|merge|brief|report <task-id>');
}

function taskStart(pc: PlanCtx, id: string, opts: Opts): Result {
  const { plan, ctx, cfg } = pc;
  let needsSetup = false;
  const r: Result = mutate(pc, undefined, (s) => {
    // Plans recorded on old names keep them: the task branch is new-style, the folder follows the plan folder.
    const branch = taskBranch(plan.slug, id);
    const path = join(worktreeRoot(cfg, ctx.mainRoot), `${basename(plan.worktree)}--${id}`);
    const pb = s.branch;
    const sl = findTask(s, id);
    if (!sl) throw new Refusal(`no task "${id}" in this plan`, ['cairn ready']);
    if (sl.status === 'in_progress') return { message: `Task "${sl.name}" is already running (${sl.substep}) at ${sl.worktree}.`, data: { worktree: sl.worktree, branch: sl.branch, resumed: true } };
    if (sl.status === 'done' && fastLane(s) && s.stage === 'review') {
      // A review finding reopens the fix: back to execute, keeping the repro and the task base.
      sl.status = 'pending';
      s.phases.find((p) => p.tasks.includes(sl))!.status = 'in_progress';
      setStage(s, 'execute');
      delete s.evidence.review;
      log(s, 'fix reopened', 'from review');
    }
    if (sl.status === 'done') throw new Refusal(`task "${sl.name}" is already done`);
    gate(s.stage === 'execute' && !s.paused, s, 'task start', opts, s.paused ? 'the plan is paused' : `the plan is in ${s.stage}, not execute`);
    configGate(s, cfg, 'task start', opts);
    const ready = readySet(s, cfg.maxParallel);
    const waiting = ready.waiting.find((w) => w.task.id === id);
    gate(ready.ready.some((x) => x.id === id), s, 'task start', opts, waiting ? `task "${sl.name}" is waiting on ${waiting.on.join(', ')}` : `task "${sl.name}" is not in the current phase`, ['cairn ready']);
    const base = git(['rev-parse', pb], plan.worktree);
    // The worktree is made and recorded under the lock; setup (npm ci and the like) runs after it is released.
    if (!existsSync(path)) {
      if (branchExists(branch, plan.worktree)) git(['worktree', 'add', '-q', path, branch], plan.worktree);
      else git(['worktree', 'add', '-q', '-b', branch, path, pb], plan.worktree);
      needsSetup = true;
    }
    Object.assign(sl, { status: 'in_progress', substep: 'implementing', fixRound: 0, branch, worktree: path, base: sl.base ?? base, startedAt: sl.startedAt ?? now(), level: sl.level ?? s.level });
    const phase = s.phases.find((p) => p.tasks.includes(sl))!;
    if (phase.status === 'pending') phase.status = 'in_progress';
    log(s, 'task started', sl.name);
    syncTickets(s, linearConfig(pc.cfg));
    return { message: `Started task "${sl.name}" in ${path} (branch ${branch}).`, data: { worktree: path, branch, planBranch: pb } };
  });
  ensureExcluded(ctx.mainRoot, '.claude/worktrees/');
  if (needsSetup) r.message += runSetup(cfg, String(r.data!.worktree), ctx.mainRoot);
  if (!r.data!.resumed) {
    const b = writeBrief(pc, id, 'build');
    r.message += `\nBrief: ${b.path}`;
    r.data = { ...r.data, brief: b.path, report: b.report };
  }
  return r;
}

function taskStep(pc: PlanCtx, id: string, step: string | undefined, opts: Opts): Result {
  if (!SUBSTEPS.includes(step as Substep)) throw new CliError(`usage: cairn task step <id> ${SUBSTEPS.join('|')}`);
  return mutate(pc, undefined, (s) => {
    const sl = findTask(s, id);
    if (!sl || sl.status !== 'in_progress') throw new Refusal(`task "${id}" is not running`, ['cairn task start ' + id]);
    if (step === 'fixing') {
      gate(sl.fixRound < MAX_FIX_ROUNDS, s, 'task fix round', opts, `task "${sl.name}" has used ${MAX_FIX_ROUNDS} fix attempts`, ['stop and ask the user: split the task, re-plan, or take it over']);
      sl.fixRound++;
    }
    sl.substep = step as Substep;
    if (opts.note) sl.note = String(opts.note);
    log(s, `task ${step}`, `${sl.name}${step === 'fixing' ? ` (attempt ${sl.fixRound})` : ''}${opts.note ? `: ${opts.note}` : ''}`);
    syncTickets(s, linearConfig(pc.cfg));
    return { message: `Task "${sl.name}": ${step}${step === 'fixing' ? `, attempt ${sl.fixRound} of ${MAX_FIX_ROUNDS}` : ''}.` };
  });
}

function taskDone(pc: PlanCtx, id: string, opts: Opts): Result {
  const { plan } = pc;
  const pre = loadState(plan.dir);
  const sl = findTask(pre, id);
  if (!sl) throw new Refusal(`no task "${id}" in this plan`);
  if (sl.status !== 'in_progress' || !sl.branch) throw new Refusal(`task "${sl.name}" is not running`);
  const pb = pre.branch;
  // A changed command never runs before this check (an override needs the user's proof first).
  configGate(pre, pc.cfg, 'task done', opts);
  // Evidence is gathered before taking the lock: tests can be slow.
  const merged = branchExists(sl.branch, plan.worktree) && gitOk(['merge-base', '--is-ancestor', sl.branch, pb], plan.worktree);
  const dirty = sl.worktree && existsSync(sl.worktree) ? git(['status', '--porcelain'], sl.worktree) : '';
  const tip = branchExists(sl.branch, plan.worktree) ? git(['rev-parse', '--short', sl.branch], plan.worktree) : undefined;
  const commits = tip && sl.base ? Number(git(['rev-list', '--count', `${sl.base}..${sl.branch}`], plan.worktree)) : 0;
  const planDirty = git(['status', '--porcelain', '--', '.', `:!${planRelOf(plan)}`], plan.worktree);
  const checkable = merged && !dirty && !planDirty;
  const tests = checkable ? runTests(pc.cfg, plan.worktree) : undefined;
  const testedCommit = tests ? git(['rev-parse', 'HEAD'], plan.worktree) : undefined;
  // The fix track adds: the repro now passes, and the fix stays small (FR-25). Both are checked even when an
  // override waives the checks above: the repro whenever the task is merged, the size whenever there is a base.
  // The size counts the task branch and the plan branch from the task base, so commits made beside the task count.
  const fix = fastLane(pre);
  const repro = fix && merged && pre.repro ? runRepro(pre.repro.cmd, plan.worktree, pc.cfg) : undefined;
  const heads = [pb, ...(tip ? [sl.branch] : [])];
  const changed = fix && sl.base ? new Set(heads.flatMap((h) => changedFiles(plan.worktree, plan.slug, sl.base!, h))).size : 0;
  // Files the task changed, from its base to its branch: this catches edits made through Bash, which the edit hook never sees (FR-41).
  const outside = tip && sl.base ? changedFiles(plan.worktree, plan.slug, sl.base, sl.branch).filter((f) => !matchesAny(f, sl.scope)) : [];
  // Work committed straight onto the plan branch inside the task's scope, since the task base. Merge commits are
  // skipped (a task merge is the normal path) and so is cairn's own state under docs/cairn/ (or legacy docs/sdlc/).
  // The fix track is exempt: it has its own size limit, which counts plan-branch commits.
  const stray = sl.base && !fix ? directCommits(plan.worktree, sl.base, pb).filter((c) => c.files.some((f) => !isCairnPath(f) && matchesAny(f, sl.scope))) : [];
  const maxFiles = pc.cfg.fixMaxFiles ?? DEFAULT_FIX_MAX_FILES;
  const r = mutate(pc, `task done: ${sl.name}`, (s) => {
    const cur = findTask(s, id)!;
    configGate(s, pc.cfg, 'task done', opts);
    gate(!dirty, s, 'task done', opts, `the task worktree has uncommitted changes`, [`commit or discard them in ${cur.worktree}`]);
    gate(commits > 0, s, 'task done', opts, `${cur.branch} has no commits since the task started`, ['the implementer commits its work on the task branch, in the task worktree']);
    gate(!planDirty, s, 'task done', opts, `the plan worktree has uncommitted changes outside cairn's files: ${planDirty.split('\n').slice(0, 5).join(', ')}`, ['work belongs on task branches: move it into a task, or discard it']);
    gate(!stray.length, s, 'task done', opts, `commits for task "${cur.name}" were made directly on ${pb}: ${stray.map((c) => c.sha).join(', ')}`, [`move these commits to the task branch (git cherry-pick them onto ${cur.branch}, then reset ${pb} to before them), then merge the task branch with --no-ff`]);
    gate(merged, s, 'task done', opts, `${cur.branch} is not merged into ${pb}`, [`git -C ${plan.worktree} merge --no-ff ${cur.branch}`]);
    testsGate(tests ?? (checkable ? undefined : { ok: false, ran: false, cmd: pc.cfg.test ?? '(none)', tail: 'not run' }), s, 'task done', opts, cur.scope);
    if (fix) {
      gate(repro?.outcome === 'passes', s, 'task done', opts, repro ? `the repro still fails (\`${s.repro?.cmd}\` → ${repro.detail})` : 'the repro was not run: the task is not merged', ['fix the bug so the repro command exits 0']);
      gate(changed <= maxFiles, s, 'task done', opts, `the fix changed ${changed} files; a fix may change at most ${maxFiles}`, ['this is bigger than a fix: cairn escalate turns it into a feature plan, keeping the work']);
    }
    for (const path of outside)
      if (!s.drift.some((d) => d.path === path && !d.acked)) {
        s.drift.push({ path, at: now(), reason: `changed outside task "${cur.name}" scope (found at task done)`, task: cur.id });
        log(s, 'drift', path);
      }
    Object.assign(cur, { status: 'done', substep: undefined, doneAt: now(), tip, tests: tests ? `${tests.cmd} → ${tests.tail}` : undefined, testedCommit: tests?.ok ? testedCommit : undefined });
    const phase = s.phases.find((p) => p.tasks.some((x) => x.id === id))!;
    phase.status = phaseStatus(phase, phase.status);
    // The fix track has no phase stop: the single phase is done with its task.
    if (fastLane(s) && phase.status === 'awaiting_approval') phase.status = 'done';
    log(s, 'task done', cur.name);
    syncTickets(s, linearConfig(pc.cfg));
    const left = phase.tasks.filter((x) => x.status !== 'done').length;
    return {
      message: `Task "${cur.name}" done${tests ? ` (tests: ${tests.tail})` : ' (no test command configured: nothing was run)'}. ${left ? `${left} task(s) left in phase "${phase.name}".` : fastLane(s) ? 'The fix is built: `cairn advance` to review.' : currentPhase(s) === phase ? `Phase "${phase.name}" is built: run \`cairn phase finish\`.` : `Phase "${phase.name}" is built; it finishes after the earlier phases.`}`,
      data: { phaseComplete: !left },
    };
  });
  // Clean up the task worktree and branch once its work is in the plan branch.
  if (merged && sl.worktree && existsSync(sl.worktree)) gitOk(['worktree', 'remove', sl.worktree], plan.worktree);
  if (merged) gitOk(['branch', '-d', sl.branch], plan.worktree);
  return r;
}

const DOCS_ROOTS = ['docs/cairn/', 'docs/sdlc/'];

/** Merge the task branch into the plan branch (--no-ff), settle plan-file conflicts, then run `task done`. */
function taskMerge(pc: PlanCtx, id: string, opts: Opts): Result {
  const { plan } = pc;
  const pre = loadState(plan.dir);
  const sl = findTask(pre, id);
  if (!sl) throw new Refusal(`no task "${id}" in this plan`);
  if (sl.status !== 'in_progress' || !sl.branch) throw new Refusal(`task "${sl.name}" is not running`, ['cairn task start ' + id]);
  const pb = pre.branch;
  if (!branchExists(sl.branch, plan.worktree)) throw new Refusal(`branch ${sl.branch} does not exist`);
  let note: string;
  if (!gitOk(['merge-base', '--is-ancestor', sl.branch, pb], plan.worktree)) {
    if (git(['rev-parse', '--abbrev-ref', 'HEAD'], plan.worktree) !== pb) throw new Refusal(`the plan worktree is not on ${pb}`, [`git -C ${plan.worktree} switch ${pb}`]);
    const m = gitTry(['merge', '--no-ff', sl.branch, '-m', `merge task ${id}`], plan.worktree);
    let kept = '';
    if (!m.ok) {
      const files = gitTry(['diff', '--name-only', '--diff-filter=U'], plan.worktree).out.split('\n').filter(Boolean);
      const planOnly = files.length > 0 && files.every((f) => DOCS_ROOTS.some((d) => f.startsWith(d)));
      if (!planOnly) {
        // Leave nothing half-merged: no MERGE_HEAD, so the fixer starts from a clean plan worktree.
        gitTry(['merge', '--abort'], plan.worktree);
        if (!files.length) throw new Refusal(`merging ${sl.branch} into ${pb} failed: ${m.out.split('\n').slice(-2).join(' ')}`);
        mutate(pc, undefined, (s) => {
          findTask(s, id)!.mergeConflict = files;
          log(s, 'task merge conflict', `${sl.name}: ${files.join(', ')}`);
        });
        throw new Refusal(`merging task "${sl.name}" conflicts in: ${files.join(', ')}`, [
          `dispatch a Fix · merge implementer with \`cairn task brief ${id} --role fix\`: merge ${pb} into ${sl.branch} in ${sl.worktree}, resolve, commit; then cairn task merge ${id} again`,
        ]);
      }
      for (const f of files) {
        if (gitTry(['checkout', '--ours', '--', f], plan.worktree).ok) git(['add', '--', f], plan.worktree);
        else git(['rm', '-q', '--', f], plan.worktree);
      }
      git(['commit', '-q', '--no-edit'], plan.worktree);
      kept = ` Kept the plan's side of ${files.length} plan file${files.length === 1 ? '' : 's'} that conflicted.`;
    }
    note = `Merged ${sl.branch} into ${pb}.${kept}`;
  } else note = `${sl.branch} was already merged into ${pb}.`;
  if (sl.mergeConflict)
    mutate(pc, undefined, (s) => {
      delete findTask(s, id)!.mergeConflict;
    });
  const r = taskDone(pc, id, opts);
  return { ...r, message: `${note}\n${r.message}`, data: { ...r.data, merged: true } };
}
