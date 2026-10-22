import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { cmdLevel } from '../src/commands/level.ts';
import { context } from '../src/locate.ts';
import { run } from '../src/main.ts';
import { Refusal } from '../src/util.ts';
import { pd } from './plandir.ts';

const repos: string[] = [];
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
after(() => repos.forEach((r) => rmSync(r, { recursive: true, force: true })));

let repo: string;
/** A fresh repository with one plan at the given level; returns the plan worktree. */
function mkPlan(level: string, track = 'feature'): string {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-level-')));
  repos.push(repo);
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
  return run(['new', 'lv', '--title', 'lv', '--track', track, '--level', level], repo).data!.worktree as string;
}
/** Act as the user through the mod, as lifecycle.test.ts does. */
function asUser<T>(fn: () => T): T {
  const secret = randomBytes(16).toString('hex');
  mkdirSync(join(repo, '.git/cairn'), { recursive: true });
  writeFileSync(join(repo, '.git/cairn/mod-secret.sha256'), createHash('sha256').update(secret).digest('hex'), { mode: 0o600 });
  process.env.CAIRN_APPROVER = secret;
  try {
    return fn();
  } finally {
    delete process.env.CAIRN_APPROVER;
  }
}
const lvl = (wt: string, ...argv: string[]) => asUser(() => run(['level', ...argv], wt));
const refused = (wt: string, pattern: RegExp, ...argv: string[]) =>
  assert.throws(() => asUser(() => run(['level', ...argv], wt)), (e: unknown) => e instanceof Refusal && pattern.test(e.message));
const file = (wt: string) => join(pd(wt, 'lv'), 'state.json');
const stateOf = (wt: string) => JSON.parse(readFileSync(file(wt), 'utf8'));
function edit(wt: string, fn: (s: Record<string, any>) => void) {
  const s = stateOf(wt);
  fn(s);
  writeFileSync(file(wt), JSON.stringify(s, null, 2));
}
const task = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, name: id, covers: [], blockedBy: [], scope: [`src/${id}/**`], complexity: 'simple', status, fixRound: 0, ...extra,
});
const withTasks = (wt: string, tasks: unknown[], stage = 'execute') =>
  edit(wt, (s) => {
    s.stage = stage;
    s.phases = [{ id: 'p', name: 'P', status: 'in_progress', tasks }];
  });
const approved = { at: 'x', via: 'human', source: 'mod' };

test('without proof, raising refuses and says how to run it with --human or the pane', () => {
  const wt = mkPlan('mvp');
  assert.throws(
    () => run(['level', 'polished'], wt),
    (e: unknown) => e instanceof Refusal && /level changes come from the user/.test(e.message) && e.fixes.some((f) => /cairn level polished --human/.test(f)) && e.fixes.some((f) => /pane/.test(f)),
  );
  assert.equal(stateOf(wt).level, 'mvp');
});

test('with proof, raising MVP to Standard during discover succeeds and logs the change', () => {
  const wt = mkPlan('mvp');
  lvl(wt, 'standard');
  const s = stateOf(wt);
  assert.equal(s.level, 'standard');
  assert.ok(s.log.some((l: { event: string; detail?: string }) => l.event === 'level changed' && l.detail === 'mvp -> standard'));
});

test('an unknown level refuses and names the three values', () => {
  const wt = mkPlan('mvp');
  assert.throws(() => run(['level', 'fast'], wt), (e: unknown) => /not a level: use mvp, standard, polished/.test((e as Error).message));
});

test('setting the current level again succeeds without proof', () => {
  const wt = mkPlan('mvp');
  const r = run(['level', 'mvp'], wt);
  assert.match(r.message, /already/);
  assert.equal(stateOf(wt).log.filter((l: { event: string }) => l.event === 'level changed').length, 0);
});

test('lowering during prd with no task started succeeds', () => {
  const wt = mkPlan('polished');
  edit(wt, (s) => (s.stage = 'prd'));
  lvl(wt, 'mvp');
  assert.equal(stateOf(wt).level, 'mvp');
});

test('AE4: lowering after a task started refuses, even after a re-plan moved the stage back to plan', () => {
  const wt = mkPlan('polished');
  withTasks(wt, [task('a', 'in_progress', { startedAt: '2026-01-01T00:00:00Z' })], 'plan');
  refused(wt, /only allowed before any task starts/, 'standard');
  assert.equal(stateOf(wt).level, 'polished');
});

test('AE7: raising an approved plan at the plan stage clears the plan approval', () => {
  const wt = mkPlan('mvp');
  edit(wt, (s) => {
    s.stage = 'plan';
    s.approvals.plan = approved;
  });
  lvl(wt, 'polished');
  assert.equal(stateOf(wt).approvals.plan, undefined);
});

test('raising during execute before any task started sends the plan back for approval', () => {
  const wt = mkPlan('mvp');
  edit(wt, (s) => (s.approvals.plan = approved));
  withTasks(wt, [task('a', 'pending')]);
  lvl(wt, 'polished');
  const s = stateOf(wt);
  assert.equal(s.approvals.plan, undefined);
  assert.equal(s.stage, 'plan');
});

test('raising during execute after a task started leaves the plan approval in place', () => {
  const wt = mkPlan('mvp');
  edit(wt, (s) => (s.approvals.plan = approved));
  withTasks(wt, [task('a', 'in_progress', { startedAt: '2026-01-01T00:00:00Z', level: 'mvp' })]);
  lvl(wt, 'standard');
  assert.ok(stateOf(wt).approvals.plan);
});

test('raising during review clears Check and review evidence and moves the stage back to verify', () => {
  const wt = mkPlan('mvp');
  edit(wt, (s) => {
    s.evidence.verify = { result: 'pass', at: 'x' };
    s.evidence.review = { result: 'pass', at: 'x' };
  });
  withTasks(wt, [task('a', 'done', { startedAt: 'x', level: 'mvp' })], 'review');
  lvl(wt, 'standard');
  const s = stateOf(wt);
  assert.equal(s.stage, 'verify');
  assert.equal(s.evidence.verify, undefined);
  assert.equal(s.evidence.review, undefined);
  assert.equal(s.stageHistory.at(-1).stage, 'verify');
});

test('raising during verify clears the recorded Check result and stays at verify', () => {
  const wt = mkPlan('mvp');
  edit(wt, (s) => (s.evidence.verify = { result: 'fail', at: 'x' }));
  withTasks(wt, [task('a', 'done', { startedAt: 'x', level: 'mvp' })], 'verify');
  lvl(wt, 'polished');
  const s = stateOf(wt);
  assert.equal(s.stage, 'verify');
  assert.equal(s.evidence.verify, undefined);
});

test("AE3: raising MVP to Standard after two tasks finished files two hardening items with those tasks' scopes", () => {
  const wt = mkPlan('mvp');
  withTasks(wt, [
    task('a', 'done', { startedAt: 'x', level: 'mvp' }),
    task('b', 'done', { startedAt: 'x', level: 'mvp' }),
    task('c', 'done', { startedAt: 'x', level: 'standard' }),
    task('d', 'pending', { level: 'mvp' }),
  ]);
  lvl(wt, 'standard');
  const items = stateOf(wt).suggestions as { kind: string; from: string; where: string[] }[];
  assert.equal(items.length, 2);
  assert.ok(items.every((x) => x.kind === 'hardening' && x.from === 'mvp'));
  assert.deepEqual(items.map((x) => x.where), [['src/a/**'], ['src/b/**']]);
});

test('raising files a hardening item for a task still in progress, not only finished ones', () => {
  const wt = mkPlan('mvp');
  withTasks(wt, [task('a', 'done', { startedAt: 'x', level: 'mvp' }), task('d', 'in_progress', { startedAt: 'x', level: 'mvp' })]);
  lvl(wt, 'standard');
  const items = stateOf(wt).suggestions as { where: string[] }[];
  assert.deepEqual(items.map((x) => x.where), [['src/a/**'], ['src/d/**']]);
});

test('two successive raises file one item per task, and restamp the task level', () => {
  const wt = mkPlan('mvp');
  withTasks(wt, [task('a', 'done', { startedAt: 'x', level: 'mvp' }), task('d', 'in_progress', { startedAt: 'x', level: 'mvp' })]);
  lvl(wt, 'standard');
  lvl(wt, 'polished');
  const s = stateOf(wt);
  assert.equal(s.suggestions.length, 2);
  assert.deepEqual(s.phases[0].tasks.map((t: { level: string }) => t.level), ['polished', 'polished']);
});

test('--human proof is taken before the plan lock is held', () => {
  const wt = mkPlan('mvp');
  let lockedDuringProof: boolean | undefined;
  const io = {
    isTTY: () => true,
    readLine: () => {
      lockedDuringProof = existsSync(join(pd(wt, 'lv'), '.lock'));
      return 'lv';
    },
  };
  cmdLevel(context(wt), 'standard', { human: true }, io);
  assert.equal(lockedDuringProof, false);
  assert.equal(stateOf(wt).level, 'standard');
});

test('a refusal comes before the proof is asked for', () => {
  const wt = mkPlan('polished');
  withTasks(wt, [task('a', 'in_progress', { startedAt: 'x', level: 'polished' })]);
  let asked = false;
  const io = { isTTY: () => true, readLine: () => ((asked = true), 'lv') };
  assert.throws(() => cmdLevel(context(wt), 'mvp', { human: true }, io), (e: unknown) => e instanceof Refusal);
  assert.equal(asked, false);
});

test('level refuses on a paused plan, a fix plan, and at ship', () => {
  const wt = mkPlan('mvp');
  edit(wt, (s) => (s.paused = { at: 'x', mode: 'drain' }));
  refused(wt, /paused/, 'standard');
  edit(wt, (s) => {
    s.paused = null;
    s.stage = 'ship';
  });
  refused(wt, /ship/, 'standard');
  const fx = mkPlan('mvp', 'fix');
  refused(fx, /fix/, 'standard');
});
