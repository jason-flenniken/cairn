import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { branchExists, git } from '../git.ts';
import { planRelIn, planRelOf, type Ctx } from '../locate.ts';
import type { Config, State } from '../types.ts';
import { CliError, hashText, now, readText, Refusal } from '../util.ts';
import { childEnv, gate, mutate, planCtx, type Opts, type Result } from '../shared.ts';
import { allTasks } from '../ready.ts';
import { loadState, log } from '../state.ts';
import { appendDecision } from './plans.ts';

const DEFAULT_REPRO_TIMEOUT_MINUTES = 10;

/** A plan on the fast lane: a fix plan with a repro (or about to record one). v0.1 fix plans have neither and keep the feature stages. */
export const fastLane = (s: State): boolean => s.track === 'fix' && (s.stage === 'repro' || !!s.repro);

/** Hash of the commands cairn runs for the plan (FR-32). A missing config hashes as empty. */
export const configHash = (cfg: Config): string => hashText(JSON.stringify({ setup: cfg.setup, test: cfg.test, build: cfg.build }));

/** Refuse while the configured commands differ from the ones the user approved. Plans without a recorded hash are not checked. */
export function configGate(s: State, cfg: Config, event: string, opts: Opts): void {
  gate(
    !s.configHash || s.configHash === configHash(cfg),
    s,
    event,
    opts,
    'the setup, test, or build command in .sdlc/config.json changed since the user approved it',
    ['the user re-approves the commands by running, in their own terminal: cairn approve plan --human', 'or the user chooses Override in the menu'],
  );
}

/** Files changed from base to head, a rename counting once. The plan's own folder is cairn's state, not part of the change. */
export const changedFiles = (cwd: string, slug: string, base: string, head: string): string[] =>
  git(['diff', '--name-only', '-z', '-M', base, head, '--', '.', `:!${planRelIn(slug, cwd)}`], cwd).split('\0').filter(Boolean);

/** How a repro run ended. `detail` is the last output line, or the error when it timed out or could not start. */
export interface ReproRun {
  outcome: 'fails' | 'passes' | 'timeout' | 'nostart';
  detail: string;
}

/**
 * Starts the command as a job in its own process group (set -m), writes the group id to $2, and waits for it.
 * A timeout kills only the outer sh, so the group id lets cairn stop everything the command started.
 */
const GROUP_WRAPPER = 'set -m; sh -c "$1" & set +m; echo $! > "$2"; wait $!';

const SETPGID_FAILURE = /child setpgid \(.*\): Operation not permitted/;

/** Run a repro command in the plan worktree, without CAIRN_APPROVER, under the configured timeout. */
export function runRepro(cmd: string, cwd: string, cfg: Config): ReproRun {
  const minutes = cfg.reproTimeoutMinutes ?? DEFAULT_REPRO_TIMEOUT_MINUTES;
  const tmp = mkdtempSync(join(tmpdir(), 'cairn-repro-'));
  const pidFile = join(tmp, 'pgid');
  const r = spawnSync('sh', ['-c', GROUP_WRAPPER, 'sh', cmd, pidFile], { cwd, encoding: 'utf8', env: childEnv(), timeout: minutes * 60_000, maxBuffer: 64 * 1024 * 1024 });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  const pgid = Number(readText(pidFile));
  if (timedOut && pgid > 0) {
    try {
      process.kill(-pgid, 'SIGKILL');
    } catch {}
  }
  rmSync(tmp, { recursive: true, force: true });
  // Under a sandbox that refuses setpgid, the shell reports it on stderr; the command still ran, so the report is not output.
  const lines = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').map((l) => l.trim()).filter((l) => l && !SETPGID_FAILURE.test(l));
  const last = lines.slice(-1)[0] ?? `exit ${r.status}`;
  if (timedOut) return { outcome: 'timeout', detail: `timed out after ${Math.round(minutes * 60)}s` };
  if (r.error) return { outcome: 'nostart', detail: r.error.message };
  // sh reports a command it cannot find or execute with 127 or 126.
  if (r.status === 126 || r.status === 127) return { outcome: 'nostart', detail: last };
  return { outcome: r.status === 0 ? 'passes' : 'fails', detail: last };
}

export function cmdRepro(ctx: Ctx, cmd: string | undefined, opts: Opts): Result {
  if (!cmd) throw new CliError('usage: cairn repro "<command>"');
  const pc = planCtx(ctx);
  const pre = loadState(pc.plan.dir);
  if (pre.track !== 'fix') throw new Refusal('cairn repro is for fix plans', ['start one with cairn new <slug> --track fix']);
  // A changed command never runs before the refusal; with --override the in-lock check logs it.
  // Nothing runs until the stage and the approved commands check out (an override needs the user's proof first).
  gate(pre.stage === 'repro', pre, 'repro', opts, `the plan is in ${pre.stage}, not repro`);
  configGate(pre, pc.cfg, 'repro', opts);
  const ran = runRepro(cmd, pc.plan.worktree, pc.cfg);
  return mutate(pc, 'repro recorded', (s) => {
    configGate(s, pc.cfg, 'repro', opts);
    gate(s.stage === 'repro', s, 'repro', opts, `the plan is in ${s.stage}, not repro`);
    if (ran.outcome === 'timeout' || ran.outcome === 'nostart')
      throw new Refusal(`the repro command ${ran.outcome === 'timeout' ? 'did not finish' : 'could not start'}: ${ran.detail}`, ['write a repro command that runs and finishes']);
    if (ran.outcome === 'passes') throw new Refusal('the command exits 0: this does not reproduce the bug', ['write a command that fails while the bug is present']);
    s.repro = { cmd, tail: ran.detail, at: now() };
    s.configHash = configHash(pc.cfg);
    log(s, 'repro recorded', `${cmd} → ${ran.detail}`);
    return { message: `Repro recorded: \`${cmd}\` fails (${ran.detail}). Next: \`cairn advance\` to the fix.`, data: { repro: s.repro } };
  });
}

/** Turn a fix plan into a feature plan at prd, keeping the fix task and its work (FR-28). */
export function cmdEscalate(ctx: Ctx, opts: Opts): Result {
  const pc = planCtx(ctx);
  const pre = loadState(pc.plan.dir);
  if (pre.track !== 'fix') throw new Refusal('only a fix plan can be escalated; this is a feature plan');
  if (pre.stage === 'closed') throw new Refusal('the plan is closed');
  // The files each started task changed: committed from its base to its branch (or its recorded tip once merged
  // and removed), plus uncommitted work in a running task's worktree. Glob characters become `?` so the scope
  // stays a set of literal paths.
  const changed = new Map<string, string[]>();
  const own = planRelOf(pc.plan) + '/';
  for (const sl of allTasks(pre)) {
    const head = sl.branch && branchExists(sl.branch, pc.plan.worktree) ? sl.branch : sl.tip;
    if (!sl.base || !head) continue;
    const files = changedFiles(pc.plan.worktree, pre.slug, sl.base, head);
    if (sl.status === 'in_progress' && sl.worktree && existsSync(sl.worktree))
      for (const args of [['diff', '--name-only', '-z', 'HEAD'], ['ls-files', '--others', '--exclude-standard', '-z']])
        files.push(...git(args, sl.worktree).split('\0').filter((f) => f && !f.startsWith(own)));
    changed.set(sl.id, [...new Set(files.map((f) => f.replace(/[*?]/g, '?')))].sort());
  }
  return mutate(pc, 'escalated to a feature plan', (s) => {
    for (const sl of allTasks(s)) sl.scope = changed.get(sl.id) ?? [];
    const repro = s.repro ? `\`${s.repro.cmd}\` (failed with: ${s.repro.tail})` : 'none recorded';
    appendDecision(pc, 'Escalate the fix to a feature plan', `The bug "${s.title}" is bigger than a fix. Repro: ${repro}. The fix task and its work are kept; the plan must keep the task id "fix".`, typeof opts.note === 'string' ? opts.note : undefined);
    s.track = 'feature';
    s.stage = 'prd';
    delete s.evidence.review;
    delete s.approvals.ship;
    log(s, 'escalated', 'fix → feature plan at prd');
    return { message: `"${s.title}" is now a feature plan at the PRD stage. The fix task keeps its work, with its scope narrowed to the files it changed. Next: write the PRD.` };
  });
}
