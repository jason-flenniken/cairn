import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { run } from '../src/main.ts';
import { Refusal } from '../src/util.ts';
import { pd } from './plandir.ts';

let repo: string;
let remote: string;
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const refused = (wt: string, re: RegExp, ...args: string[]) =>
  assert.throws(
    () => run(args, wt),
    (e: unknown) => e instanceof Refusal && re.test(e.message),
  );
const stateOf = (wt: string, slug: string) => JSON.parse(readFileSync(join(pd(wt, slug), 'state.json'), 'utf8'));
function edit(wt: string, slug: string, fn: (s: Record<string, any>) => void) {
  const f = join(pd(wt, slug), 'state.json');
  const s = JSON.parse(readFileSync(f, 'utf8'));
  fn(s);
  writeFileSync(f, JSON.stringify(s, null, 2));
}
/** Commit the plan folder so the plan branch holds everything the plan wrote. */
const commitPlan = (wt: string) => {
  g(wt, 'add', '-A');
  g(wt, 'commit', '-q', '-m', 'plan files');
};
/** A feature plan at learn with a valid record. */
function learnPlan(slug: string): string {
  const wt = run(['new', slug, '--title', slug], repo).data!.worktree as string;
  edit(wt, slug, (s) => (s.stage = 'learn'));
  copyFileSync(join(import.meta.dirname, '../../templates/record.md'), join(pd(wt, slug), 'RECORD.md'));
  commitPlan(wt);
  return wt;
}
/** What the PR merge does: the plan branch lands in main. */
const mergePr = (wt: string, slug: string) => g(repo, 'merge', '-q', '--no-ff', '-m', `merge ${slug}`, stateOf(wt, slug).branch);

before(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-merged-')));
  remote = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-merged-remote-')));
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
});

test('close refuses while the plan branch is not merged, names the open PR, and status shows PR open', () => {
  const wt = learnPlan('open1');
  refused(wt, /pull request is still open/, 'close');
  assert.equal(stateOf(wt, 'open1').stage, 'learn');
  assert.match(run(['status'], wt).message, /PR open/);
  assert.equal(run(['status', '--json'], wt).data!.prOpen, true);
});

test('close succeeds once the branch is merged into the base, and status no longer says PR open', () => {
  const wt = learnPlan('merged1');
  mergePr(wt, 'merged1');
  assert.doesNotMatch(run(['status'], wt).message, /PR open/);
  assert.match(run(['close'], wt).message, /Closed/);
  assert.equal(stateOf(wt, 'merged1').stage, 'closed');
});

test('a fix plan at ship is refused the same way when its branch is not merged, and closes after the merge', () => {
  const wt = run(['new', 'fixopen', '--track', 'fix', '--title', 'Fix'], repo).data!.worktree as string;
  edit(wt, 'fixopen', (s) => {
    s.stage = 'ship';
    s.repro = { cmd: 'true', at: new Date().toISOString() };
    s.approvals.ship = { at: new Date().toISOString(), via: 'human', source: 'terminal' };
    s.evidence.review = { result: 'pass', at: new Date().toISOString() };
  });
  const body = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ');
  writeFileSync(join(pd(wt, 'fixopen'), 'RECORD.md'), ['Links', 'Bug', 'Cause', 'Fix', 'Evidence'].map((h) => `## ${h}\n${body}\n`).join('\n'));
  commitPlan(wt);
  refused(wt, /pull request is still open/, 'advance');
  assert.equal(stateOf(wt, 'fixopen').stage, 'ship');
  mergePr(wt, 'fixopen');
  run(['advance'], wt);
  assert.equal(stateOf(wt, 'fixopen').stage, 'closed');
});

test('an override of the merged check without proof is refused and the stage stays', () => {
  const wt = learnPlan('noproof');
  refused(wt, /override needs proof/, 'close', '--override', 'merge it later');
  assert.equal(stateOf(wt, 'noproof').stage, 'learn');
});

test('the remote base wins when origin has it: merged locally but not on origin is still open', () => {
  g(remote, 'init', '-q', '--bare', '-b', 'main');
  g(repo, 'remote', 'add', 'origin', remote);
  g(repo, 'push', '-q', 'origin', 'main');
  const wt = learnPlan('remote1');
  mergePr(wt, 'remote1');
  refused(wt, /pull request is still open/, 'close');
  g(repo, 'push', '-q', 'origin', 'main');
  assert.match(run(['close'], wt).message, /Closed/);
});

test('when the base cannot be fetched, close says merge status is unknown', () => {
  const wt = learnPlan('offline1');
  mergePr(wt, 'offline1');
  g(repo, 'remote', 'set-url', 'origin', join(remote, 'does-not-exist'));
  refused(wt, /merge status unknown/, 'close');
  assert.equal(stateOf(wt, 'offline1').stage, 'learn');
  refused(wt, /override needs proof/, 'close', '--override', 'offline');
  g(repo, 'remote', 'set-url', 'origin', remote);
});
