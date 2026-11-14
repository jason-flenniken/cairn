import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.ts';
import { commitPath, commonDir, gitTry } from './git.ts';
import { allTasks } from './ready.ts';
import { PLANS_DIRS, planRelOf, requirePlan, type Ctx, type PlanRef } from './locate.ts';
import { humanProof, type ProofIO } from './proof.ts';
import { emptySections, missingSections, RECORD_SECTIONS, RECORD_WORD_BUDGET, wordCount } from './sections.ts';
import { levelOf, loadState, log, saveState } from './state.ts';
import type { Config, State, Suggestion } from './types.ts';
import { now, pluginRoot, readText, Refusal, withLock } from './util.ts';

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

export interface PlanCtx {
  ctx: Ctx;
  plan: Required<PlanRef>;
  cfg: Config;
}

export interface TestRun {
  ok: boolean;
  /** False when the suite never executed (a dirty or unmerged worktree, or a spawn error): that is not a test failure. */
  ran: boolean;
  cmd: string;
  tail: string;
  /** Everything the suite printed, for a log file; never put in a message. */
  output?: string;
  /** A red run's log file (`<work>/reports/tests.log`), set by `recordTestRun`. */
  log?: string;
  /** Up to five failing lines of a red run, set by `recordTestRun`. */
  failing?: string[];
  /** The commit the suite ran on. Set only when HEAD and the tracked files outside cairn's folders held still for the whole run. */
  head?: string;
  /** True when the run hit `testTimeoutMinutes` and was stopped. */
  timedOut?: boolean;
}

/**
 * The command being run, set by planCtx. Each kind of proof is checked at most once per command,
 * pass or fail: the secret is spent on first use, and --human asks once.
 * null records a check that failed.
 */
let current: { ctx: Ctx; human?: { source: 'mod' | 'terminal' } | null } | undefined;

function humanOnce(opts: Opts, io?: ProofIO): { source: 'mod' | 'terminal' } | undefined {
  if (!current) return undefined;
  if (current.human === undefined) current.human = humanProof(current.ctx, opts, io) ?? null;
  return current.human ?? undefined;
}

/** Approvals and level changes come from the user: the mod's menu or pane, or a terminal run with --human. */
export function requireHumanProof(kind: string, opts: Opts, io?: ProofIO, action: 'approve' | 'level' = 'approve'): 'mod' | 'terminal' {
  const p = humanOnce(opts, io);
  if (p) return p.source;
  const slug = current?.ctx.plan?.slug;
  const cmd = `cd ${current?.ctx.plan?.worktree ?? '<plan worktree>'} && ${pluginRoot()}/bin/cairn ${action} ${kind} --human`;
  if (action === 'level')
    throw new Refusal('level changes come from the user, and this command has no proof that one did', [
      `the user answers the level menu tagged [cairn:level ${slug}]`,
      `or the user runs, in their own terminal: ${cmd}`,
      'or the user changes the level in the cairn pane (or runs /cairn-level)',
    ]);
  throw new Refusal('approvals come from the user, and this command has no proof that one did', [
    `the user answers "Approve (Recommended)" in the approval menu tagged [cairn:approve ${kind} ${slug}]`,
    `or the user runs, in their own terminal: ${cmd}`,
    'or the user presses Approve in the cairn pane (or runs /cairn:approve)',
  ]);
}

/** Refuse unless the condition holds; an override with the user's proof lets it through and is logged. */
export function gate(ok: boolean, s: State, event: string, opts: Opts, message: string, fixes: string[] = []): void {
  if (ok) return;
  if (opts.override) {
    const human = humanOnce(opts);
    if (!human)
      throw new Refusal(`${message}; an override needs proof that the user chose it`, [
        `the user answers "Override" in a menu tagged [cairn:override ${s.slug}], and the mod runs the command`,
        'or the user runs this command, with --override, in their own terminal with --human',
      ]);
    log(s, `override: ${event}`, `${message} (source: ${human.source})`, opts.override);
    return;
  }
  throw new Refusal(message, [...fixes, `or, if the user chose to skip this: add --override "<reason>"`]);
}

export function planCtx(ctx: Ctx): PlanCtx {
  const plan = requirePlan(ctx);
  current = { ctx };
  return { ctx, plan, cfg: loadConfig(plan.worktree, ctx.mainRoot) };
}

/** Locked read-modify-write of state, then an optional commit of the plan dir. */
export function mutate<T>(pc: PlanCtx, commitMsg: string | undefined, fn: (s: State) => T): T {
  const r = withLock(pc.plan.dir, () => {
    const s = loadState(pc.plan.dir);
    const out = fn(s);
    // A step belongs to one stage: any change of stage clears it.
    if (s.step && s.step.stage !== s.stage) delete s.step;
    saveState(pc.plan.dir, s);
    return out;
  });
  if (commitMsg && pc.cfg.autoCommit) commitPath(pc.plan.worktree, planRelOf(pc.plan), `cairn(${pc.plan.slug}): ${commitMsg}`);
  return r;
}

export const planFile = (pc: PlanCtx, name: string) => join(pc.plan.dir, name);

/** The environment for commands the plan's config runs. CAIRN_APPROVER never reaches them (FR-33). */
export function childEnv(): NodeJS.ProcessEnv {
  const { CAIRN_APPROVER: _approver, ...rest } = process.env;
  return rest;
}

const COUNTS = /\b(?:pass(?:ed|ing)?|fail(?:ed|ing|ures?)?)\b\s*[:=]?\s*\d|\d+\s+(?:pass(?:ed|ing)?|fail(?:ed|ing|ures?)?)\b/i;

/** The last line that reports pass or fail counts (FR-36), else the last line. */
export const testSummary = (lines: string[]): string | undefined => [...lines].reverse().find((l) => COUNTS.test(l)) ?? lines.slice(-1)[0];

export const DEFAULT_TEST_TIMEOUT_MINUTES = 30;

/** HEAD plus the tracked changes outside cairn's own folders: what a test run is a run of. Untracked output (coverage, caches) is not part of it. */
function testInput(cwd: string): string | undefined {
  const head = gitTry(['rev-parse', 'HEAD'], cwd);
  if (!head.ok) return undefined;
  const status = gitTry(['status', '--porcelain', '--untracked-files=no', '--', '.', ...PLANS_DIRS.map((d) => `:!${d}`)], cwd);
  return `${head.out}\n${status.ok ? status.out : '?'}`;
}

export function runTests(cfg: Config, cwd: string): TestRun | undefined {
  if (!cfg.test) return undefined;
  const minutes = cfg.testTimeoutMinutes ?? DEFAULT_TEST_TIMEOUT_MINUTES;
  const before = testInput(cwd);
  const r = spawnSync('sh', ['-c', cfg.test], { cwd, encoding: 'utf8', env: childEnv(), maxBuffer: 64 * 1024 * 1024, timeout: minutes * 60_000, killSignal: 'SIGKILL' });
  const lines = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').map((l) => l.trim()).filter(Boolean);
  const output = lines.join('\n');
  if ((r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT')
    return { ok: false, ran: true, timedOut: true, cmd: cfg.test, tail: `timed out after ${minutes} min (testTimeoutMinutes); the suite was stopped`, output };
  const after = testInput(cwd);
  if (before !== after)
    return { ok: false, ran: true, cmd: cfg.test, tail: 'the checkout changed while the tests ran (a commit, checkout or edit), so the result belongs to no single commit; run again', output };
  return { ok: r.status === 0, ran: !r.error, cmd: cfg.test, tail: testSummary(lines) ?? `exit ${r.status}`, output, head: before?.split('\n')[0] };
}

/** A hardening item is a follow-up an MVP plan leaves behind; its `where` is never empty. */
export function addHardening(s: State, item: Pick<Suggestion, 'area' | 'text' | 'where'> & { testCmd?: string }): Suggestion {
  return pushSuggestion(s, { ...item, from: 'mvp', kind: 'hardening' });
}

/** Append a suggestion (or marker) to the plan: the next `s<n>` id and the current time are filled in. */
export function pushSuggestion(s: State, partial: Omit<Suggestion, 'id' | 'at'>): Suggestion {
  const all = (s.suggestions ??= []);
  const x: Suggestion = { id: `s${all.length + 1}`, ...partial, at: now() };
  all.push(x);
  return x;
}

/** The union of the plan's task scopes: where a whole-suite failure is said to be. */
export const planScope = (s: State): string[] => {
  const all = [...new Set(allTasks(s).flatMap((t) => t.scope))];
  return all.length ? all : ['**'];
};

/** This plan's open failing-suite items: not resolved, not merged into another item. */
export function knownFailures(s: State): Suggestion[] {
  const all = s.suggestions ?? [];
  const gone = new Set(all.flatMap((x) => [x.resolves, ...(x.merges ?? [])]));
  return all.filter((x) => x.testCmd && !gone.has(`${s.slug}:${x.id}`));
}

/**
 * Refuse (or log an override) when the tests failed. No test command is a warning, not a refusal. Tests run before the state lock is taken.
 * At MVP a suite that ran and failed is a warning plus one hardening item per command, scoped to the task or, outside a task, the plan.
 */
export function testsGate(t: TestRun | undefined, s: State, event: string, opts: Opts, scope?: string[]): TestRun | undefined {
  if (!t) {
    log(s, `warning: ${event}`, 'no test command configured, so nothing was run');
    return undefined;
  }
  const open = knownFailures(s).find((x) => x.testCmd === t.cmd);
  if (t.ok && open) {
    pushSuggestion(s, { area: open.area, text: `Resolved ${s.slug}:${open.id}`, where: open.where, from: 'mvp', resolves: `${s.slug}:${open.id}` });
  }
  if (!t.ok && t.ran && levelOf(s) === 'mvp') {
    const text = `Tests failing: \`${t.cmd}\` → ${t.tail}`;
    if (open) open.text = text;
    else addHardening(s, { area: 'tests', text, where: scope?.length ? scope : planScope(s), testCmd: t.cmd });
    log(s, `warning: ${event}`, `tests are not green (\`${t.cmd}\` → ${t.tail}); recorded as a hardening item`);
    return t;
  }
  gate(t.ok, s, event, opts, `tests are not green (\`${t.cmd}\` → ${t.tail})${t.log ? `. Full output: ${t.log}` : ''}`, ['fix the failing tests, then retry']);
  return t;
}

/** Prepare a fresh worktree; failure is reported, not fatal. */
export function runSetup(cfg: Config, wt: string, mainRoot: string): string {
  if (!cfg.setup) return '';
  const r = spawnSync('sh', ['-c', cfg.setup], { cwd: wt, encoding: 'utf8', env: { ...childEnv(), CAIRN_MAIN_ROOT: mainRoot }, maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? `\nSetup ran: ${cfg.setup}` : `\nSetup failed (\`${cfg.setup}\`, exit ${r.status}): ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`;
}

export function docProblems(md: string | undefined, file: string, required: readonly string[]): string[] {
  if (md === undefined) return [`${file} does not exist`];
  const p: string[] = [];
  const missing = missingSections(md, required);
  if (missing.length) p.push(`${file} is missing sections: ${missing.join(', ')}`);
  const empty = emptySections(md, required);
  if (empty.length) p.push(`${file} has empty sections: ${empty.join(', ')}`);
  return p;
}

export function recordProblems(pc: PlanCtx): string[] {
  const md = readText(planFile(pc, 'RECORD.md'));
  const p = docProblems(md, 'RECORD.md', RECORD_SECTIONS);
  if (md && wordCount(md) > RECORD_WORD_BUDGET) p.push(`RECORD.md is ${wordCount(md)} words; the budget is ${RECORD_WORD_BUDGET}`);
  return p;
}

export function ensureExcluded(mainRoot: string, pattern: string): void {
  const file = join(commonDir(mainRoot), 'info', 'exclude');
  const cur = readText(file) ?? '';
  if (!cur.split('\n').includes(pattern)) {
    mkdirSync(join(commonDir(mainRoot), 'info'), { recursive: true });
    appendFileSync(file, `${cur.endsWith('\n') || !cur ? '' : '\n'}${pattern}\n`);
  }
}

/** Keep a plan folder's lock and atomic-write temp files out of `git status`, so a crashed command never leaves the tree looking dirty. */
export function excludeScratch(mainRoot: string): void {
  for (const d of PLANS_DIRS) for (const p of [`/${d}/*/.lock/`, `/${d}/*/*.tmp`]) ensureExcluded(mainRoot, p);
}

export function template(name: string): string | undefined {
  try {
    return readText(join(pluginRoot(), 'templates', name));
  } catch {
    return undefined;
  }
}
