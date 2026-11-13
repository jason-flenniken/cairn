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
  assert.deepEqual(s.stackedOn, { slug: 'lib', branch: 'feature/lib', tip: g(baseWt, 'rev-parse', 'HEAD') });
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
  assert.equal(stateOf(appWt, 'edge').stackedOn.slug, 'core');
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

/** Put a plan in ship with a passing review and a record, ready for `approve ship`. */
function readyToShip(wt: string, slug: string) {
  edit(wt, slug, (x) => {
    x.stage = 'ship';
    x.evidence.review = { result: 'pass', at: new Date().toISOString(), blocking: 0 };
  });
  copyFileSync(join(import.meta.dirname, '../../templates/record.md'), join(pd(wt, slug), 'RECORD.md'));
  commitAll(wt, `${slug}: record`);
}
const dropBranch = (wt: string, branch: string) => {
  g(repo, 'worktree', 'remove', '--force', wt);
  g(repo, 'branch', '-D', branch);
};

test('new --after records the base tip, and refuses --track fix', () => {
  const baseWt = built('tip-base', { 'tb.txt': 'x\n' });
  refused(repo, /fix plan cannot start after another plan/, 'new', 'tip-fix', '--track', 'fix', '--after', 'tip-base');
  const appWt = run(['new', 'tip-app', '--title', 'tip-app', '--after', 'tip-base'], repo).data!.worktree as string;
  assert.equal(stateOf(appWt, 'tip-app').stackedOn.tip, g(baseWt, 'rev-parse', 'HEAD'));
  writeFileSync(join(baseWt, 'tb2.txt'), 'y\n');
  commitAll(baseWt, 'tip-base: more');
  run(['next'], appWt);
  assert.equal(stateOf(appWt, 'tip-app').stackedOn.tip, g(baseWt, 'rev-parse', 'HEAD'), 'the tip follows each merge of the base');
});

test('a base branch deleted unmerged is refused, not treated as merged: the plan stays stacked and cannot ship', () => {
  const baseWt = built('gone-base', { 'gone.txt': 'abandoned\n' });
  const appWt = run(['new', 'gone-app', '--title', 'gone-app', '--after', 'gone-base'], repo).data!.worktree as string;
  readyToShip(appWt, 'gone-app');
  dropBranch(baseWt, 'feature/gone-base');
  const out = run(['next'], appWt);
  assert.match(out.message, /has no branch \(feature\/gone-base\)/);
  assert.match(out.message, /restore feature\/gone-base, or merge plan gone-base/);
  const s = stateOf(appWt, 'gone-app');
  assert.equal(s.base, 'feature/gone-base', 'not moved onto main');
  assert.equal(s.stackedOn.slug, 'gone-base');
  asUser(() => refused(appWt, /stacked on plan gone-base, whose branch cannot be read/, 'approve', 'ship'));
});

test('a base merged into main and then deleted moves the plan onto main', () => {
  const baseWt = built('del-base', { 'del.txt': 'del\n' });
  const appWt = run(['new', 'del-app', '--title', 'del-app', '--after', 'del-base'], repo).data!.worktree as string;
  readyToShip(appWt, 'del-app');
  g(repo, 'merge', '--no-ff', '-q', '-m', 'Merge feature/del-base', 'feature/del-base');
  dropBranch(baseWt, 'feature/del-base');
  assert.match(run(['next'], appWt).message, /moved onto main after del-base merged/);
  const s = stateOf(appWt, 'del-app');
  assert.equal(s.base, 'main');
  assert.equal(s.stackedOn, undefined);
  asUser(() => run(['approve', 'ship'], appWt));
});

test('a base kept only on the remote is followed while unmerged, blocks shipping, and counts once its tip is in origin/main', () => {
  const remote = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-stack-origin-')));
  g(remote, 'init', '-q', '--bare', '-b', 'main');
  g(repo, 'remote', 'add', 'origin', remote);
  try {
    g(repo, 'push', '-q', 'origin', 'main');
    const baseWt = built('rem-base', { 'rem.txt': 'rem\n' });
    const appWt = run(['new', 'rem-app', '--title', 'rem-app', '--after', 'rem-base'], repo).data!.worktree as string;
    readyToShip(appWt, 'rem-app');
    g(baseWt, 'push', '-q', 'origin', 'feature/rem-base');
    dropBranch(baseWt, 'feature/rem-base');
    // Unmerged: nothing to move onto, and shipping waits.
    assert.doesNotMatch(run(['next'], appWt).message, /moved onto/);
    assert.equal(stateOf(appWt, 'rem-app').stackedOn.slug, 'rem-base');
    asUser(() => refused(appWt, /stacked on plan rem-base/, 'approve', 'ship'));
    // The base lands on origin/main and its branch is deleted everywhere.
    g(repo, 'fetch', '-q', 'origin');
    g(repo, 'merge', '--no-ff', '-q', '-m', 'Merge rem-base', 'origin/feature/rem-base');
    g(repo, 'push', '-q', 'origin', 'main');
    g(repo, 'push', '-q', 'origin', '--delete', 'feature/rem-base');
    g(repo, 'remote', 'prune', 'origin');
    assert.match(run(['next'], appWt).message, /moved onto main after rem-base merged/);
    assert.equal(stateOf(appWt, 'rem-app').stackedOn, undefined);
  } finally {
    g(repo, 'remote', 'remove', 'origin');
    rmSync(remote, { recursive: true, force: true });
  }
});

test('restack waits while a task is running, and says so', () => {
  const baseWt = built('run-base', { 'run.txt': 'run\n' });
  const appWt = run(['new', 'run-app', '--title', 'run-app', '--after', 'run-base'], repo).data!.worktree as string;
  edit(appWt, 'run-app', (s) => {
    s.stage = 'execute';
    s.phases = [{ id: 'p', name: 'p', status: 'in_progress', tasks: [{ id: 't', name: 't', covers: [], blockedBy: [], scope: ['src/**'], complexity: 'standard', status: 'in_progress', fixRound: 0, risky: false }] }];
  });
  commitAll(appWt, 'run-app: building');
  writeFileSync(join(baseWt, 'run2.txt'), 'more\n');
  commitAll(baseWt, 'run-base: more');
  const out = run(['next'], appWt);
  assert.match(out.message, /the base plan run-base moved; it merges in once the running tasks finish/);
  assert.equal(existsSync(join(appWt, 'run2.txt')), false, 'nothing merged mid-build');
  edit(appWt, 'run-app', (s) => {
    s.phases[0].tasks[0].status = 'done';
    s.phases[0].status = 'done';
  });
  commitAll(appWt, 'run-app: built');
  assert.match(run(['next'], appWt).message, /merged 1 new commit from run-base/);
});

test('merge-check checks the stage and the approval before it restacks', () => {
  const baseWt = built('ord-base', { 'ord.txt': 'ord\n' });
  const appWt = run(['new', 'ord-app', '--title', 'ord-app', '--after', 'ord-base'], repo).data!.worktree as string;
  writeFileSync(join(baseWt, 'ord2.txt'), 'more\n');
  commitAll(baseWt, 'ord-base: more');
  refused(appWt, /runs after the ship approval; the plan is in discover/, 'merge-check');
  assert.equal(existsSync(join(appWt, 'ord2.txt')), false, 'nothing was merged before the refusal');
});
