import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.ts';
import { commitPath, commonDir } from './git.ts';
import { planRel, requirePlan, type Ctx, type PlanRef } from './locate.ts';
import { consumeGrant, humanProof, type ProofIO } from './proof.ts';
import { emptySections, missingSections, RECORD_SECTIONS, RECORD_WORD_BUDGET, wordCount } from './sections.ts';
import { loadState, log, saveState } from './state.ts';
import type { Config, State } from './types.ts';
import { pluginRoot, readText, Refusal, withLock } from './util.ts';

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
  cmd: string;
  tail: string;
}

/**
 * The command being run, set by planCtx. Each kind of proof is checked at most once per command,
 * pass or fail: the secret rotates and a grant is consumed on first use, and --human asks once.
 * null records a check that failed.
 */
let current: { ctx: Ctx; human?: { source: 'mod' | 'terminal' } | null; grant?: { reason: string } | null } | undefined;

function humanOnce(opts: Opts, io?: ProofIO): { source: 'mod' | 'terminal' } | undefined {
  if (!current) return undefined;
  if (current.human === undefined) current.human = humanProof(current.ctx, opts, io) ?? null;
  return current.human ?? undefined;
}

/** Take the plan's grant once per command, even when other proof covers the override, so none is left waiting. */
function grantOnce(slug: string): { reason: string } | undefined {
  if (!current) return undefined;
  if (current.grant === undefined) current.grant = consumeGrant(commonDir(current.ctx.mainRoot), slug) ?? null;
  return current.grant ?? undefined;
}

/** Approvals come from the user: the mod's menu or pane, or a terminal run with --human. */
export function requireHumanProof(kind: string, opts: Opts, io?: ProofIO): 'mod' | 'terminal' {
  const p = humanOnce(opts, io);
  if (p) return p.source;
  throw new Refusal('approvals come from the user, and this command has no proof that one did', [
    `the user answers "Approve (Recommended)" in the approval menu tagged [cairn:approve ${kind} ${current?.ctx.plan?.slug}]`,
    `or the user runs, in their own terminal: cairn approve ${kind} --human`,
    'or the user presses Approve in the cairn pane (or runs /cairn:approve)',
  ]);
}

/** Refuse unless the condition holds; an override with the user's proof lets it through and is logged. */
export function gate(ok: boolean, s: State, event: string, opts: Opts, message: string, fixes: string[] = []): void {
  if (ok) return;
  if (opts.override) {
    const human = humanOnce(opts);
    const grant = grantOnce(s.slug);
    if (!human && !grant)
      throw new Refusal(`${message}; an override needs proof that the user chose it`, [
        `the user answers "Override" in a menu tagged [cairn:override ${s.slug}], then retry within 10 minutes`,
        'or the user runs this command, with --override, in their own terminal with --human',
      ]);
    log(s, `override: ${event}`, `${message} (source: ${human?.source ?? 'grant'})`, human ? opts.override : grant!.reason);
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
    saveState(pc.plan.dir, s);
    return out;
  });
  if (commitMsg && pc.cfg.autoCommit) commitPath(pc.plan.worktree, planRel(pc.plan.slug), `cairn(${pc.plan.slug}): ${commitMsg}`);
  return r;
}

export const planFile = (pc: PlanCtx, name: string) => join(pc.plan.dir, name);

/** The environment for commands the plan's config runs. CAIRN_APPROVER never reaches them (FR-33). */
export function childEnv(): NodeJS.ProcessEnv {
  const { CAIRN_APPROVER: _approver, ...rest } = process.env;
  return rest;
}

export function runTests(cfg: Config, cwd: string): TestRun | undefined {
  if (!cfg.test) return undefined;
  const r = spawnSync('sh', ['-c', cfg.test], { cwd, encoding: 'utf8', env: childEnv(), maxBuffer: 64 * 1024 * 1024 });
  const lines = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').map((l) => l.trim()).filter(Boolean);
  return { ok: r.status === 0, cmd: cfg.test, tail: lines.slice(-1)[0] ?? `exit ${r.status}` };
}

/** Refuse (or log an override) when the tests failed or don't exist. Tests run before the state lock is taken. */
export function testsGate(t: TestRun | undefined, s: State, event: string, opts: Opts): TestRun | undefined {
  if (!t) {
    gate(false, s, event, opts, 'no test command configured', ['add "test": "<command>" to .sdlc/config.json']);
    return undefined;
  }
  gate(t.ok, s, event, opts, `tests are not green (\`${t.cmd}\` → ${t.tail})`, ['fix the failing tests, then retry']);
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

export function template(name: string): string | undefined {
  try {
    return readText(join(pluginRoot(), 'templates', name));
  } catch {
    return undefined;
  }
}
