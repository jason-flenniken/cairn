import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { run } from '../src/main.ts';
import { Refusal } from '../src/util.ts';
import { pd } from './plandir.ts';

let repo: string;
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

before(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-followups-')));
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

const refused = (wt: string, re: RegExp, ...args: string[]) =>
  assert.throws(
    () => run(args, wt),
    (e: unknown) => e instanceof Refusal && re.test(e.message),
  );
type Row = { key: string; status: string; open: boolean; declined: number; where: string[] };
const rows = (wt: string): Row[] => run(['suggest', 'list', '--json'], wt).data!.suggestions as Row[];
const rowOf = (wt: string, key: string) => rows(wt).find((r) => r.key === key)!;
const statusOf = (wt: string, key: string) => rowOf(wt, key)?.status;

/** Edit a plan's saved record directly, to set up a stage or an age the CLI cannot reach quickly. */
function edit(wt: string, slug: string, fn: (s: Record<string, any>) => void) {
  const f = join(pd(wt, slug), 'state.json');
  const s = JSON.parse(readFileSync(f, 'utf8'));
  fn(s);
  writeFileSync(f, JSON.stringify(s, null, 2));
}
const toLearn = (wt: string, slug: string) => {
  edit(wt, slug, (s) => (s.stage = 'learn'));
  copyFileSync(join(import.meta.dirname, '../../templates/record.md'), join(pd(wt, slug), 'RECORD.md'));
};

test('close refuses more than 5 open follow-ups and names them; merging three lets it pass', () => {
  const wt = run(['new', 'many', '--title', 'Many'], repo).data!.worktree as string;
  for (let i = 1; i <= 6; i++) run(['suggest', 'add', '--area', 'tests', '--where', `src/p${i}/**`, '--text', `cover case ${i}`], wt);
  toLearn(wt, 'many');
  refused(wt, /6 open follow-ups.*many:s1.*many:s6/, 'close');

  const m = run(['suggest', 'merge', 'many:s1', 'many:s2', 'many:s3', '--area', 'tests', '--text', 'add more detailed tests'], wt);
  assert.equal(m.data!.key, 'many:s7');
  assert.deepEqual(['many:s1', 'many:s2', 'many:s3'].map((k) => statusOf(wt, k)), ['merged', 'merged', 'merged']);
  assert.equal(statusOf(wt, 'many:s7'), 'open');
  assert.deepEqual(rowOf(wt, 'many:s7').where, ['src/p1/**', 'src/p2/**', 'src/p3/**']);
  assert.equal(rows(wt).filter((r) => r.key.startsWith('many:') && r.open).length, 4);
  assert.match(run(['close'], wt).message, /Closed "Many"/);
});

test('close counts only follow-ups from the closing plan', () => {
  const wt = run(['new', 'other', '--title', 'Other'], repo).data!.worktree as string;
  for (let i = 1; i <= 6; i++) run(['suggest', 'add', '--area', 'ux', '--text', `other ${i}`], wt);
  const wt2 = run(['new', 'quiet', '--title', 'Quiet'], repo).data!.worktree as string;
  toLearn(wt2, 'quiet');
  assert.match(run(['close'], wt2).message, /Closed/);
});

test('a follow-up declined twice, or 61 days old, is expired, not open', () => {
  const wt = run(['new', 'aging', '--title', 'Aging'], repo).data!.worktree as string;
  run(['suggest', 'add', '--area', 'docs', '--text', 'declined twice'], wt);
  run(['suggest', 'add', '--area', 'docs', '--text', 'old one'], wt);
  run(['suggest', 'add', '--area', 'docs', '--text', 'fresh'], wt);
  edit(wt, 'aging', (s) => (s.suggestions[1].at = new Date(Date.now() - 61 * 86_400_000).toISOString()));
  assert.equal(statusOf(wt, 'aging:s2'), 'expired');
  assert.match(run(['suggest', 'decline', 'aging:s1'], wt).message, /Declined 1\.$/);
  assert.equal(statusOf(wt, 'aging:s1'), 'open');
  assert.equal(rowOf(wt, 'aging:s1').declined, 1);
  assert.match(run(['suggest', 'decline', 'aging:s1'], wt).message, /expired: aging:s1/);
  assert.equal(statusOf(wt, 'aging:s1'), 'expired');
  assert.equal(statusOf(wt, 'aging:s3'), 'open');
  assert.deepEqual(rows(wt).filter((r) => r.key.startsWith('aging:') && r.open).map((r) => r.key), ['aging:s3']);
  refused(wt, /already expired/, 'suggest', 'decline', 'aging:s1');
  refused(wt, /already expired/, 'suggest', 'merge', 'aging:s1', 'aging:s3', '--area', 'docs', '--text', 'x');
});

test('discovery flow: matching follow-ups found by path; picking one closes it and the rest show one decline', () => {
  const wt = run(['new', 'found', '--title', 'Found'], repo).data!.worktree as string;
  run(['suggest', 'add', '--area', 'tests', '--where', 'src/pane/**', '--text', 'pane tests'], wt);
  run(['suggest', 'add', '--area', 'ux', '--where', 'src/pane/view.ts', '--text', 'pane spacing'], wt);
  run(['suggest', 'add', '--area', 'perf', '--where', 'src/other/**', '--text', 'unrelated'], wt);
  const hit = (run(['suggest', 'list', '--open', '--for', 'src/pane/view.ts', '--json'], wt).data!.suggestions as Row[]).map((r) => r.key);
  assert.deepEqual(hit, ['found:s1', 'found:s2']);
  run(['suggest', 'resolve', 'found:s1', '--note', 'brought into found'], wt);
  run(['suggest', 'decline', 'found:s2'], wt);
  assert.equal(statusOf(wt, 'found:s1'), 'closed');
  assert.equal(statusOf(wt, 'found:s2'), 'open');
  assert.equal(rowOf(wt, 'found:s2').declined, 1);
  assert.throws(() => run(['suggest', 'merge', 'found:s2', '--area', 'ux', '--text', 'x'], wt), /at least two/);
});
