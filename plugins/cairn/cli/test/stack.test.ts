import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { run } from '../src/main.ts';
import { Refusal } from '../src/util.ts';
import { pd } from './plandir.ts';

let repo: string;
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const stateOf = (wt: string, slug: string) => JSON.parse(readFileSync(join(pd(wt, slug), 'state.json'), 'utf8'));
function edit(wt: string, slug: string, fn: (s: Record<string, any>) => void) {
  const f = join(pd(wt, slug), 'state.json');
  const s = JSON.parse(readFileSync(f, 'utf8'));
  fn(s);
  writeFileSync(f, JSON.stringify(s, null, 2));
}
const commitAll = (cwd: string, msg: string) => {
  g(cwd, 'add', '-A');
  g(cwd, 'commit', '-q', '-m', msg);
};
const refused = (cwd: string, pattern: RegExp, ...argv: string[]) =>
  assert.throws(
    () => run(argv, cwd),
    (e: unknown) => {
      assert.ok(e instanceof Refusal, `expected a refusal, got ${e}`);
      assert.match(`${e.message}\n${e.fixes.join('\n')}`, pattern);
      return true;
    },
  );
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
/** A plan that has finished building: in verify, with one code commit. */
function built(slug: string, files: Record<string, string>): string {
  const wt = run(['new', slug, '--title', slug], repo).data!.worktree as string;
  for (const [f, text] of Object.entries(files)) writeFileSync(join(wt, f), text);
  edit(wt, slug, (s) => (s.stage = 'verify'));
  commitAll(wt, `${slug}: code`);
  return wt;
}

before(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-stack-')));
  g(repo, 'init', '-q', '-b', 'main');
  mkdirSync(join(repo, '.cairn'));
  writeFileSync(join(repo, '.cairn/config.json'), JSON.stringify({ autoCommit: true }));
  writeFileSync(join(repo, 'shared.txt'), 'one\n');
  writeFileSync(join(repo, '.gitignore'), '.claude/\n');
  commitAll(repo, 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

test('new --after refuses a plan that does not exist, is not built yet, or is checked against another --from', () => {
  const baseWt = run(['new', 'base', '--title', 'base'], repo).data!.worktree as string;
  refused(repo, /no plan named "nope"/, 'new', 'c0', '--after', 'nope');
  refused(repo, /has not finished building yet \(it is in discover\)/, 'new', 'c0', '--after', 'base');
  edit(baseWt, 'base', (s) => (s.stage = 'verify'));
  commitAll(baseWt, 'verify');
  refused(repo, /name different branches/, 'new', 'c0', '--after', 'base', '--from', 'main');
});

test('new --after a built plan starts on its branch and records stackedOn; ship waits for the base to merge; restack follows the base, then main', () => {
  const baseWt = built('lib', { 'lib.txt': 'lib\n' });
  const r = run(['new', 'app', '--title', 'app', '--after', 'lib'], repo);
  const appWt = r.data!.worktree as string;
  assert.match(r.message, /stacked on plan lib/);
  const s = stateOf(appWt, 'app');
  assert.deepEqual(s.stackedOn, { slug: 'lib', branch: 'feature/lib' });
  assert.equal(s.base, 'feature/lib');
  assert.equal(existsSync(join(appWt, 'lib.txt')), true, 'the new plan starts with the base plan\'s code');
  assert.match(run(['status'], appWt).message, /Stacked on lib/);

  // New commits on the base plan are merged in by `next`, and the merge is vouched for.
  writeFileSync(join(baseWt, 'lib2.txt'), 'more\n');
  commitAll(baseWt, 'lib: more');
  const caught = run(['next'], appWt);
  assert.match(caught.message, /merged 1 new commit from lib/);
  assert.equal(existsSync(join(appWt, 'lib2.txt')), true);
  assert.equal(stateOf(appWt, 'app').baseMerges.length, 1);
  assert.equal(stateOf(appWt, 'app').stackedOn.slug, 'lib');
  assert.doesNotMatch(run(['next'], appWt).message, /merged \d/, 'nothing new the second time');

  // Ship is refused while the base plan has not merged.
  writeFileSync(join(appWt, 'app.txt'), 'app\n');
  edit(appWt, 'app', (x) => {
    x.stage = 'ship';
    x.evidence.review = { result: 'pass', at: new Date().toISOString(), blocking: 0 };
  });
  copyFileSync(join(import.meta.dirname, '../../templates/record.md'), join(pd(appWt, 'app'), 'RECORD.md'));
  commitAll(appWt, 'app: code and record');
  asUser(() => refused(appWt, /stacked on plan lib, which has not merged yet/, 'approve', 'ship'));

  // The base plan merges into main: `next` moves the plan onto main.
  g(repo, 'merge', '--no-ff', '-q', '-m', 'Merge feature/lib', 'feature/lib');
  const moved = run(['next'], appWt);
  assert.match(moved.message, /moved onto main after lib merged/);
  const after = stateOf(appWt, 'app');
  assert.equal(after.base, 'main');
  assert.equal(after.stackedOn, undefined);
  assert.equal(g(appWt, 'status', '--porcelain'), '');
  assert.match(g(appWt, 'log', '--format=%s', '-n', '5'), /Merge main into feature\/app/);
  assert.equal(g(appWt, 'merge-base', '--is-ancestor', 'main', 'HEAD') === '', true);
  asUser(() => run(['approve', 'ship'], appWt));
  assert.ok(stateOf(appWt, 'app').approvals.ship);
  assert.match(run(['merge-check'], appWt).message, /Up to date with main/, 'merge-check runs on the moved plan');
});

test('merge-check moves a stacked plan onto main first', () => {
  const baseWt = built('mc-base', { 'mc.txt': 'mc\n' });
  const appWt = run(['new', 'mc-app', '--title', 'mc-app', '--after', 'mc-base'], repo).data!.worktree as string;
  writeFileSync(join(appWt, 'mc-app.txt'), 'x\n');
  edit(appWt, 'mc-app', (x) => {
    x.stage = 'ship';
    x.evidence.review = { result: 'pass', at: new Date().toISOString(), blocking: 0 };
  });
  copyFileSync(join(import.meta.dirname, '../../templates/record.md'), join(pd(appWt, 'mc-app'), 'RECORD.md'));
  commitAll(appWt, 'mc-app: code and record');
  void baseWt;
  g(repo, 'merge', '--no-ff', '-q', '-m', 'Merge feature/mc-base', 'feature/mc-base');
  asUser(() => run(['approve', 'ship'], appWt));
  const out = run(['merge-check'], appWt);
  assert.match(out.message, /Restacked: moved onto main after mc-base merged/);
  assert.equal(stateOf(appWt, 'mc-app').base, 'main');
});

test('a restack conflict comes back as the text of next, names the files, aborts the merge and leaves the plan stacked', () => {
  built('core', { 'conflict.txt': 'a\n' });
  const appWt = run(['new', 'edge', '--title', 'edge', '--after', 'core'], repo).data!.worktree as string;
  writeFileSync(join(appWt, 'conflict.txt'), 'edge\n');
  commitAll(appWt, 'edge: change');
  g(repo, 'merge', '--no-ff', '-q', '-m', 'Merge feature/core', 'feature/core');
  writeFileSync(join(repo, 'conflict.txt'), 'main\n');
  commitAll(repo, 'main: change conflict.txt');
  const out = run(['next'], appWt);
  assert.match(out.message, /conflict/);
  assert.match(out.message, /conflict\.txt/);
  assert.equal(g(appWt, 'status', '--porcelain'), '', 'the merge was aborted');
  assert.deepEqual(stateOf(appWt, 'edge').stackedOn, { slug: 'core', branch: 'feature/core' });
  assert.equal(stateOf(appWt, 'edge').base, 'feature/core');
});

test('restack refuses a dirty worktree', () => {
  const baseWt = built('dirtybase', { 'd.txt': 'd\n' });
  const appWt = run(['new', 'dirtyapp', '--title', 'dirtyapp', '--after', 'dirtybase'], repo).data!.worktree as string;
  writeFileSync(join(baseWt, 'd2.txt'), 'x\n');
  commitAll(baseWt, 'more');
  writeFileSync(join(appWt, 'loose.txt'), 'uncommitted\n');
  const out = run(['next'], appWt);
  assert.match(out.message, /uncommitted changes: loose\.txt/);
  assert.equal(existsSync(join(appWt, 'd2.txt')), false, 'nothing merged');
});
