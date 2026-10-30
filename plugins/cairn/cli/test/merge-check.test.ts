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
let remote: string;
/** The conflict test's plan worktree, which the hand-resolved merge test picks up. */
let conflictWt: string;
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
/** Act as the user through the mod: write the hash of a fresh mod secret and pass the secret in CAIRN_APPROVER. */
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
/** A change landing on main (and origin/main) while the plan waits to merge. */
function moveMain(file: string, text: string) {
  writeFileSync(join(repo, file), text);
  commitAll(repo, `main: ${file}`);
  g(repo, 'push', '-q', 'origin', 'main');
}
/** A closed feature plan whose ship was approved, with one code commit, as the Merge step finds it. */
function shipped(slug: string, code: Record<string, string> = { [`${slug}.txt`]: 'code\n' }): string {
  const wt = run(['new', slug, '--title', slug], repo).data!.worktree as string;
  for (const [f, text] of Object.entries(code)) writeFileSync(join(wt, f), text);
  edit(wt, slug, (s) => {
    s.stage = 'ship';
    s.evidence.review = { result: 'pass', at: new Date().toISOString(), blocking: 0 };
  });
  copyFileSync(join(import.meta.dirname, '../../templates/record.md'), join(pd(wt, slug), 'RECORD.md'));
  commitAll(wt, 'code, record and plan files');
  asUser(() => run(['approve', 'ship'], wt));
  edit(wt, slug, (s) => (s.stage = 'closed'));
  commitAll(wt, 'closed');
  return wt;
}

before(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-mergecheck-')));
  remote = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-mergecheck-remote-')));
  g(remote, 'init', '-q', '--bare', '-b', 'main');
  g(repo, 'init', '-q', '-b', 'main');
  mkdirSync(join(repo, '.cairn'));
  // The suite fails while broken.txt exists, so a test can break it from main.
  writeFileSync(join(repo, '.cairn/config.json'), JSON.stringify({ test: 'test ! -f broken.txt', autoCommit: true }));
  writeFileSync(join(repo, 'shared.txt'), 'one\n');
  writeFileSync(join(repo, '.gitignore'), '.claude/\n');
  commitAll(repo, 'init');
  g(repo, 'remote', 'add', 'origin', remote);
  g(repo, 'push', '-q', 'origin', 'main');
});
after(() => {
  for (const d of [repo, remote]) rmSync(d, { recursive: true, force: true });
});

test('ship approval records the commit it approved', () => {
  const wt = shipped('pin1');
  const sha = stateOf(wt, 'pin1').approvals.ship.sha;
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(g(wt, 'merge-base', '--is-ancestor', sha, 'HEAD'), '');
});

test('up to date with main: passes, prints the HEAD it checked, and passes again', () => {
  const wt = shipped('uptodate');
  const r = run(['merge-check'], wt);
  assert.match(r.message, /Up to date with main/);
  assert.equal(r.data!.head, g(wt, 'rev-parse', 'HEAD'));
  assert.match(r.message, /--match-head-commit [0-9a-f]{40}/);
  assert.equal(r.data!.merged, false);
  assert.match(run(['merge-check'], wt).message, /Up to date/);
});

test('main moved without conflicts: merges it in, runs the tests, and the merge needs no new approval', () => {
  const wt = shipped('moved');
  moveMain('other.txt', 'from main\n');
  const r = run(['merge-check'], wt);
  assert.equal(r.data!.merged, true);
  assert.equal(r.data!.behind, 1);
  assert.match(r.message, /merged it in cleanly\. The tests pass/);
  assert.ok(existsSync(join(wt, 'other.txt')));
  assert.equal(stateOf(wt, 'moved').baseMerges.length, 1);
  assert.ok(stateOf(wt, 'moved').approvals.ship, 'a clean merge cairn made keeps the approval');
  assert.match(run(['merge-check'], wt).message, /Up to date/);
});

test('main moved with a conflict: the merge is aborted, the worktree is clean, and the approval stays', () => {
  const wt = (conflictWt = shipped('conflict', { 'shared.txt': 'plan side\n' }));
  moveMain('shared.txt', 'main side\n');
  refused(wt, /conflict with this branch in shared\.txt[\s\S]*aborted[\s\S]*asks for the ship approval again/, 'merge-check');
  assert.equal(g(wt, 'status', '--porcelain'), '');
  assert.equal(readFileSync(join(wt, 'shared.txt'), 'utf8'), 'plan side\n');
  assert.ok(stateOf(wt, 'conflict').approvals.ship);
});

test('a merge resolved by hand clears the approval; approving again restores it', () => {
  const wt = conflictWt;
  assert.throws(() => g(wt, 'merge', '-q', 'origin/main'));
  writeFileSync(join(wt, 'shared.txt'), 'resolved\n');
  commitAll(wt, 'resolve the merge by hand');
  refused(wt, /approving again: code changed after you approved shipping \(merge [0-9a-f]{7}, which cairn did not make/, 'merge-check');
  const s = stateOf(wt, 'conflict');
  assert.equal(s.approvals.ship, undefined);
  assert.match(s.reapprove.why, /merge [0-9a-f]{7}, which cairn did not make/);
  const status = run(['status', '--json'], wt).data!;
  assert.equal((status.ready as { kind: string }).kind, 'ship');
  assert.match(run(['next'], wt).message, /Approve shipping again/);
  refused(wt, /approving again/, 'merge-check');
  asUser(() => run(['approve', 'ship'], wt));
  const after = stateOf(wt, 'conflict');
  assert.equal(after.reapprove, undefined);
  assert.equal(after.approvals.ship.sha, g(wt, 'rev-parse', 'HEAD~1'), 'the approval pins the HEAD it saw, before its own state commit');
  assert.match(run(['merge-check'], wt).message, /Up to date/);
});

test('a code commit after the approval clears it and names the files', () => {
  const wt = shipped('latecode');
  writeFileSync(join(wt, 'late.txt'), 'agent push\n');
  commitAll(wt, 'a late fix');
  refused(wt, /commits changed late\.txt/, 'merge-check');
  assert.equal(stateOf(wt, 'latecode').approvals.ship, undefined);
  refused(wt, /approvals come from the user/, 'approve', 'ship');
});

test('plan-folder and REVIEW.md commits after the approval pass', () => {
  const wt = shipped('docsonly');
  writeFileSync(join(pd(wt, 'docsonly'), 'RECORD.md'), `${readFileSync(join(pd(wt, 'docsonly'), 'RECORD.md'), 'utf8')}\n- PR: https://example.test/pull/1\n`);
  writeFileSync(join(wt, 'REVIEW.md'), '# Reviewing\n\n## Rules learned\n- **2026-10-30 · docs** — a rule. *Why:* x.\n');
  commitAll(wt, 'PR link and a ticked rule');
  assert.match(run(['merge-check'], wt).message, /Nothing changed since the ship approval/);
});

test('tests that fail with main merged in refuse, and the clean merge stays', () => {
  const wt = shipped('redtests');
  moveMain('broken.txt', 'x\n');
  refused(wt, /tests fail with main merged in[\s\S]*asks for the ship approval again/, 'merge-check');
  assert.ok(existsSync(join(wt, 'broken.txt')));
  assert.ok(stateOf(wt, 'redtests').approvals.ship);
  // Run again with no fix: the merge is in, but the head never passed, so the tests run and it still refuses.
  refused(wt, /tests fail: /, 'merge-check');
  assert.equal(stateOf(wt, 'redtests').mergeChecked, undefined);
  g(repo, 'rm', '-q', 'broken.txt');
  commitAll(repo, 'main: unbreak');
  g(repo, 'push', '-q', 'origin', 'main');
});

test('a green check is remembered: plan-folder commits after it skip the tests, a merged base runs them again', () => {
  const wt = shipped('green');
  assert.match(run(['merge-check'], wt).message, /The tests pass/);
  assert.match(stateOf(wt, 'green').mergeChecked, /^[0-9a-f]{40}$/);
  assert.match(run(['merge-check'], wt).message, /Tests passed on this code at the last check/);
  moveMain('green-main.txt', 'x\n');
  assert.match(run(['merge-check'], wt).message, /merged it in cleanly\. The tests pass/);
});

test('a conflict only in OVERVIEW.md is settled by regenerating it, and needs no new approval', () => {
  const wt = shipped('overview');
  mkdirSync(join(wt, 'docs/cairn'), { recursive: true });
  writeFileSync(join(wt, 'docs/cairn/OVERVIEW.md'), '# Changelog\n\nplan side\n');
  commitAll(wt, 'close writes the changelog');
  mkdirSync(join(repo, 'docs/cairn'), { recursive: true });
  moveMain('docs/cairn/OVERVIEW.md', '# Changelog\n\nmain side\n');
  const r = run(['merge-check'], wt);
  assert.equal(r.data!.merged, true);
  assert.equal(g(wt, 'status', '--porcelain'), '');
  assert.doesNotMatch(readFileSync(join(wt, 'docs/cairn/OVERVIEW.md'), 'utf8'), /<<<<<<<|>>>>>>>/);
  assert.ok(stateOf(wt, 'overview').approvals.ship);
  assert.match(run(['merge-check'], wt).message, /Up to date/);
});

test('a branch already in main refuses: the pull request was merged', () => {
  const wt = shipped('landed');
  g(repo, 'merge', '-q', '--no-ff', '-m', 'merge landed', stateOf(wt, 'landed').branch);
  g(repo, 'push', '-q', 'origin', 'main');
  refused(wt, /already in origin\/main/, 'merge-check');
});

test('a failed fetch refuses instead of checking against a stale main', () => {
  const wt = shipped('nofetch');
  g(wt, 'remote', 'set-url', 'origin', join(remote, 'missing'));
  try {
    refused(wt, /could not fetch origin\/main/, 'merge-check');
  } finally {
    g(wt, 'remote', 'set-url', 'origin', remote);
  }
});

test('trace names the PR merge, the plan, its record and the task that brought a line in', () => {
  g(repo, 'switch', '-q', '-c', 'feature/tracer');
  g(repo, 'switch', '-q', '-c', 'task/tracer/t1');
  writeFileSync(join(repo, 'traced.txt'), 'first\nsecond\n');
  commitAll(repo, 'the traced line');
  g(repo, 'switch', '-q', 'feature/tracer');
  g(repo, 'merge', '-q', '--no-ff', '-m', 'merge task t1', 'task/tracer/t1');
  mkdirSync(join(repo, 'docs/cairn/plans/2026-10-30-tracer'), { recursive: true });
  writeFileSync(join(repo, 'docs/cairn/plans/2026-10-30-tracer/RECORD.md'), '## Links\n');
  writeFileSync(join(repo, 'docs/cairn/plans/2026-10-30-tracer/state.json'), '{}\n');
  commitAll(repo, 'record');
  g(repo, 'switch', '-q', 'main');
  g(repo, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #12 from me/feature/tracer', 'feature/tracer');
  const r = run(['trace', 'traced.txt:2'], repo);
  assert.match(r.message, /the traced line\n  landed in main with [0-9a-f]{7} \(PR #12\), plan tracer, task t1\n  record: docs\/cairn\/plans\/2026-10-30-tracer\/RECORD\.md/);
});

test('trace does not credit a commit made on the plan branch to a later task', () => {
  g(repo, 'switch', '-q', '-c', 'feature/probe');
  writeFileSync(join(repo, 'direct.txt'), 'direct\n');
  commitAll(repo, 'a commit straight on the plan branch');
  g(repo, 'switch', '-q', '-c', 'task/probe/t9');
  writeFileSync(join(repo, 'later.txt'), 'later\n');
  commitAll(repo, 'later task work');
  g(repo, 'switch', '-q', 'feature/probe');
  g(repo, 'merge', '-q', '--no-ff', '-m', 'merge task t9', 'task/probe/t9');
  g(repo, 'switch', '-q', 'main');
  g(repo, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #20 from me/feature/probe', 'feature/probe');
  const out = run(['trace', 'direct.txt:1'], repo).message;
  assert.match(out, /\(PR #20\), plan probe$/m);
  assert.doesNotMatch(out, /task t9/);
  assert.match(run(['trace', 'later.txt:1'], repo).message, /plan probe, task t9/);
});

test('trace finds the plan of a squash merge through the PR link in its record', () => {
  mkdirSync(join(repo, 'docs/cairn/plans/2026-10-30-squashed'), { recursive: true });
  writeFileSync(join(repo, 'docs/cairn/plans/2026-10-30-squashed/RECORD.md'), '## Links\n- PR: https://github.com/me/repo/pull/13\n');
  writeFileSync(join(repo, 'squashed.txt'), 'line\n');
  commitAll(repo, 'Squashed thing (#13)');
  assert.match(run(['trace', 'squashed.txt:1'], repo).message, /\(PR #13\), plan squashed\n  record: docs\/cairn\/plans\/2026-10-30-squashed\/RECORD\.md/);
  assert.throws(() => run(['trace', 'squashed.txt'], repo), /usage: cairn trace/);
});
