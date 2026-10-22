import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { run } from '../src/main.ts';
import { levelOf } from '../src/state.ts';
import { Refusal } from '../src/util.ts';
import { pd } from './plandir.ts';

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const repos: string[] = [];
after(() => repos.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** A throwaway repo, optionally with a .sdlc/config.json. */
function makeRepo(config?: object): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-levels-')));
  repos.push(repo);
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  if (config) {
    mkdirSync(join(repo, '.sdlc'), { recursive: true });
    writeFileSync(join(repo, '.sdlc/config.json'), JSON.stringify(config));
  }
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
  return repo;
}
const fileOf = (wt: string, slug: string) => join(pd(wt, slug), 'state.json');
const stateOf = (wt: string, slug: string) => JSON.parse(readFileSync(fileOf(wt, slug), 'utf8'));
const edit = (wt: string, slug: string, fn: (s: Record<string, unknown>) => void) => {
  const s = stateOf(wt, slug);
  fn(s);
  writeFileSync(fileOf(wt, slug), JSON.stringify(s, null, 2) + '\n');
};
const newPlan = (repo: string, slug: string, ...flags: string[]) => run(['new', slug, '--title', slug, ...flags], repo);

test('cairn new --level mvp stores mvp and logs it', () => {
  const repo = makeRepo();
  const wt = newPlan(repo, 'quick', '--level', 'mvp').data!.worktree as string;
  const s = stateOf(wt, 'quick');
  assert.equal(s.level, 'mvp');
  assert.ok(s.log.some((l: { event: string; detail?: string }) => l.event === 'level' && l.detail === 'mvp'));
  assert.match(s.cairnVersion, /^\d+\.\d+\.\d+/, 'new state is stamped with the cairn version');
});

test('cairn new with no flag uses defaultLevel from config, and Standard when config has none', () => {
  const withDefault = makeRepo({ defaultLevel: 'polished' });
  assert.equal(stateOf(newPlan(withDefault, 'a').data!.worktree as string, 'a').level, 'polished');
  const without = makeRepo({ maxParallel: 2 });
  assert.equal(stateOf(newPlan(without, 'b').data!.worktree as string, 'b').level, 'standard');
});

test('cairn new --level fast refuses and names the three values', () => {
  const repo = makeRepo();
  assert.throws(
    () => newPlan(repo, 'bad', '--level', 'fast'),
    (e: unknown) => e instanceof Refusal && /mvp/.test(e.message) && /standard/.test(e.message) && /polished/.test(e.message),
  );
});

test('an invalid defaultLevel warns and creates a Standard plan', () => {
  const repo = makeRepo({ defaultLevel: 'turbo' });
  const r = newPlan(repo, 'warned');
  assert.match(r.message, /defaultLevel.*turbo/);
  assert.equal(stateOf(r.data!.worktree as string, 'warned').level, 'standard');
});

test('a fix-track plan has no level, and levelOf returns Standard', () => {
  const repo = makeRepo();
  const wt = newPlan(repo, 'crash', '--track', 'fix', '--level', 'mvp').data!.worktree as string;
  const s = stateOf(wt, 'crash');
  assert.equal(s.level, undefined);
  assert.equal(levelOf(s), 'standard');
});

test('a plan saved without a level loads and reports Standard, with an empty label', () => {
  const repo = makeRepo();
  const wt = newPlan(repo, 'old', '--level', 'mvp').data!.worktree as string;
  edit(wt, 'old', (s) => delete s.level);
  const out = run(['status', '--json'], wt).data as { level: string; levelLabel: string };
  assert.equal(out.level, 'standard');
  assert.equal(out.levelLabel, '');
});

test('task start on an MVP plan stamps the task with mvp', () => {
  const repo = makeRepo();
  const wt = newPlan(repo, 'build', '--level', 'mvp').data!.worktree as string;
  edit(wt, 'build', (s) => {
    s.stage = 'execute';
    s.phases = [
      { id: 'core', name: 'Core', status: 'in_progress', tasks: [{ id: 'a', name: 'Alpha', covers: [], blockedBy: [], scope: ['src/a/**'], complexity: 'simple', status: 'pending', fixRound: 0 }] },
    ];
  });
  run(['task', 'start', 'a'], wt);
  assert.equal(stateOf(wt, 'build').phases[0].tasks[0].level, 'mvp');
});

test('status --json includes the level and its label', () => {
  const repo = makeRepo();
  const wt = newPlan(repo, 'shown', '--level', 'polished').data!.worktree as string;
  const out = run(['status', '--json'], wt).data as { level: string; levelLabel: string };
  assert.equal(out.level, 'polished');
  assert.equal(out.levelLabel, 'Polished');
  assert.match(run(['status'], wt).message, /Polished/);
  const all = run(['status', '--all', '--json'], repo).data as { plans: { levelLabel: string }[] };
  assert.equal(all.plans[0].levelLabel, 'Polished');
  assert.equal((run(['next', '--json'], wt).data as { levelLabel: string }).levelLabel, 'Polished');
});
