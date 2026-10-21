import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { mergeState, safeRef } from '../src/git.ts';
import { run } from '../src/main.ts';
import { pd } from './plandir.ts';

let repo: string;
let remote: string;
let stubDir: string;
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const stateOf = (wt: string, slug: string) => JSON.parse(readFileSync(join(pd(wt, slug), 'state.json'), 'utf8'));
function edit(wt: string, slug: string, fn: (s: Record<string, any>) => void) {
  const f = join(pd(wt, slug), 'state.json');
  const s = JSON.parse(readFileSync(f, 'utf8'));
  fn(s);
  writeFileSync(f, JSON.stringify(s, null, 2));
}
/** Commit everything in the worktree, as the plan branch would hold it. */
const commitAll = (wt: string, msg: string) => {
  g(wt, 'add', '-A');
  g(wt, 'commit', '-q', '-m', msg);
};
/** A feature plan at learn with a valid record and one code commit on its branch. */
function learnPlan(slug: string): string {
  const wt = run(['new', slug, '--title', slug], repo).data!.worktree as string;
  edit(wt, slug, (s) => (s.stage = 'learn'));
  copyFileSync(join(import.meta.dirname, '../../templates/record.md'), join(pd(wt, slug), 'RECORD.md'));
  writeFileSync(join(wt, `${slug}.txt`), 'code\n');
  commitAll(wt, 'code and plan files');
  return wt;
}
const branchOf = (wt: string, slug: string): string => stateOf(wt, slug).branch;
/** What a merge-commit PR does: the plan branch lands in main. */
const mergePr = (wt: string, slug: string) => g(repo, 'merge', '-q', '--no-ff', '-m', `merge ${slug}`, branchOf(wt, slug));
const label = (wt: string) => run(['status'], wt).message;
const prOpen = (wt: string) => run(['status', '--json'], wt).data!.prOpen;
const ghOut = (out: string) => {
  process.env.GH_STUB_OUT = out;
  rmSync(join(repo, '.git', 'cairn-pr-state.json'), { force: true });
};

before(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-merged-')));
  remote = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-merged-remote-')));
  stubDir = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-gh-stub-')));
  // A stand-in for `gh pr view`: prints $GH_STUB_OUT, or fails when it is empty (no network in tests).
  writeFileSync(join(stubDir, 'gh'), '#!/bin/sh\n[ -n "$GH_STUB_OUT" ] || exit 1\necho "$GH_STUB_OUT"\n');
  chmodSync(join(stubDir, 'gh'), 0o755);
  process.env.PATH = `${stubDir}:${process.env.PATH}`;
  ghOut('');
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => {
  for (const d of [repo, remote, stubDir]) rmSync(d, { recursive: true, force: true });
});

test('close succeeds while the PR is open, and status, status --all and the JSON say "Closed · PR open"', () => {
  const wt = learnPlan('open1');
  assert.match(label(wt), /Learn · PR open/);
  assert.match(run(['close'], wt).message, /Closed/);
  assert.equal(stateOf(wt, 'open1').stage, 'closed');
  assert.match(label(wt), /Closed · PR open/);
  assert.equal(prOpen(wt), true);
  const all = run(['status', '--all'], wt);
  assert.match(all.message, /open1\): Closed · PR open/);
  const row = (all.data!.plans as { state: { slug: string }; prOpen: boolean }[]).find((p) => p.state.slug === 'open1');
  assert.equal(row?.prOpen, true);
});

test('the label clears once the branch is in main, even with plan-folder-only commits after the merge', () => {
  const wt = learnPlan('merged1');
  mergePr(wt, 'merged1');
  assert.doesNotMatch(label(wt), /PR open/);
  run(['close'], wt);
  // The close committed the plan folder on the branch after the merge.
  writeFileSync(join(pd(wt, 'merged1'), 'RECORD.md'), `${readFileSync(join(pd(wt, 'merged1'), 'RECORD.md'), 'utf8')}\nPR link\n`);
  commitAll(wt, 'record: PR link');
  assert.equal(prOpen(wt), false);
  assert.doesNotMatch(label(wt), /PR open/);
  const rows = run(['status', '--all'], wt).data!.plans as { state: { slug: string }; prOpen: boolean }[];
  assert.equal(rows.find((p) => p.state.slug === 'merged1')?.prOpen, false);
});

test('a code commit after the merge keeps the plan "PR open"', () => {
  const wt = learnPlan('late1');
  mergePr(wt, 'late1');
  writeFileSync(join(wt, 'late.txt'), 'late\n');
  commitAll(wt, 'one more code commit');
  assert.equal(prOpen(wt), true);
});

test('a squash merge counts as merged when gh says MERGED, and a gh failure leaves it open', () => {
  const wt = learnPlan('squash1');
  g(repo, 'merge', '-q', '--squash', branchOf(wt, 'squash1'));
  g(repo, 'commit', '-q', '-m', 'squash squash1');
  ghOut('');
  assert.equal(prOpen(wt), true, 'gh unavailable: not merged');
  ghOut('OPEN');
  assert.equal(prOpen(wt), true);
  ghOut('MERGED');
  assert.equal(prOpen(wt), false);
  assert.doesNotMatch(label(wt), /PR open/);
  ghOut('');
});

test('a fix plan closes at advance without the PR merged, then shows "Closed · PR open"', () => {
  const wt = run(['new', 'fixopen', '--track', 'fix', '--title', 'Fix'], repo).data!.worktree as string;
  edit(wt, 'fixopen', (s) => {
    s.stage = 'ship';
    s.repro = { cmd: 'true', at: new Date().toISOString() };
    s.approvals.ship = { at: new Date().toISOString(), via: 'human', source: 'terminal' };
    s.evidence.review = { result: 'pass', at: new Date().toISOString() };
  });
  const body = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ');
  writeFileSync(join(pd(wt, 'fixopen'), 'RECORD.md'), ['Links', 'Bug', 'Cause', 'Fix', 'Evidence'].map((h) => `## ${h}\n${body}\n`).join('\n'));
  writeFileSync(join(wt, 'fixopen.txt'), 'code\n');
  commitAll(wt, 'fix files');
  run(['advance'], wt);
  assert.equal(stateOf(wt, 'fixopen').stage, 'closed');
  assert.match(label(wt), /Closed · PR open/);
});

test('the remote base wins when origin has it: merged locally but not on origin is still open', () => {
  g(remote, 'init', '-q', '--bare', '-b', 'main');
  g(repo, 'remote', 'add', 'origin', remote);
  g(repo, 'push', '-q', 'origin', 'main');
  const wt = learnPlan('remote1');
  mergePr(wt, 'remote1');
  g(repo, 'fetch', '-q', 'origin');
  assert.equal(prOpen(wt), true);
  g(repo, 'push', '-q', 'origin', 'main');
  g(repo, 'fetch', '-q', 'origin');
  assert.equal(prOpen(wt), false);
});

test('status never fetches: an unreachable origin changes nothing', () => {
  const wt = learnPlan('nofetch1');
  mergePr(wt, 'nofetch1');
  g(repo, 'remote', 'set-url', 'origin', join(remote, 'does-not-exist'));
  assert.equal(prOpen(wt), true, 'origin/main was last fetched before the merge');
  g(repo, 'remote', 'set-url', 'origin', remote);
});

test('refs from state.json are validated: a base or branch that looks like an option is unknown and runs nothing', () => {
  const marker = join(tmpdir(), `cairn-pwned-${process.pid}`);
  const wt = learnPlan('evil1');
  for (const bad of [`--upload-pack=touch ${marker}`, '--output=/tmp/x', 'a b', 'x..y', 'a@{1}', '']) {
    assert.equal(safeRef(wt, bad), false, bad);
    assert.equal(mergeState(wt, branchOf(wt, 'evil1'), bad, 'docs'), 'unknown', `base ${bad}`);
    assert.equal(mergeState(wt, bad, 'main', 'docs'), 'unknown', `branch ${bad}`);
  }
  edit(wt, 'evil1', (s) => (s.base = `--upload-pack=touch ${marker}`));
  assert.equal(prOpen(wt), false, 'unknown is not shown as PR open');
  assert.doesNotMatch(label(wt), /PR open/);
  assert.equal(existsSync(marker), false);
  assert.equal(safeRef(wt, 'main'), true);
  assert.equal(safeRef(wt, branchOf(wt, 'evil1')), true);
});
