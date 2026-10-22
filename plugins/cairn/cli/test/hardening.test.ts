import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { run } from '../src/main.ts';
import { Refusal } from '../src/util.ts';
import { pd } from './plandir.ts';

const repos: string[] = [];
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
/** A fresh repository, so counts that span plans start at zero. */
function mkRepo(): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-hardening-')));
  repos.push(repo);
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
  return repo;
}
after(() => repos.forEach((r) => rmSync(r, { recursive: true, force: true })));

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
type Row = { key: string; status: string; open: boolean; kind?: string; from: string; where: string[]; text: string };
const rows = (wt: string): Row[] => run(['suggest', 'list', '--json'], wt).data!.suggestions as Row[];
const newPlan = (repo: string, slug: string, level = 'mvp') => run(['new', slug, '--title', slug, '--level', level], repo).data!.worktree as string;
const hard = (wt: string, where: string, text: string) => run(['suggest', 'add', '--kind', 'hardening', '--area', 'tests', '--where', where, '--text', text], wt);

test('AE6: an MVP plan with nine hardening items and two follow-ups closes; status counts them apart', () => {
  const repo = mkRepo();
  const wt = newPlan(repo, 'mvp');
  for (let i = 1; i <= 9; i++) hard(wt, `src/h${i}/**`, `untested area ${i}`);
  run(['suggest', 'add', '--area', 'ux', '--text', 'spacing'], wt);
  run(['suggest', 'add', '--area', 'docs', '--text', 'readme'], wt);
  toLearn(wt, 'mvp');
  assert.match(run(['close'], wt).message, /Closed "mvp"/);
  const st = run(['status', '--json'], wt).data!;
  assert.equal(st.openSuggestions, 2);
  assert.equal(st.hardeningItems, 9);
});

test('hardening items file as from "mvp", and six ordinary follow-ups still refuse close', () => {
  const repo = mkRepo();
  const wt = newPlan(repo, 'cap');
  hard(wt, 'src/a/**', 'one');
  assert.deepEqual([rows(wt)[0].kind, rows(wt)[0].from], ['hardening', 'mvp']);
  for (let i = 1; i <= 6; i++) run(['suggest', 'add', '--area', 'tests', '--text', `case ${i}`], wt);
  toLearn(wt, 'cap');
  assert.throws(() => run(['close'], wt), (e: unknown) => e instanceof Refusal && /6 open follow-ups/.test(e.message));
});

test('a hardening item declined twice and 61 days old is still open', () => {
  const repo = mkRepo();
  const wt = newPlan(repo, 'aging');
  hard(wt, 'src/a/**', 'old hardening');
  run(['suggest', 'decline', 'aging:s1'], wt);
  run(['suggest', 'decline', 'aging:s1'], wt);
  edit(wt, 'aging', (s) => (s.suggestions[0].at = new Date(Date.now() - 61 * 86_400_000).toISOString()));
  assert.equal(rows(wt).find((r) => r.key === 'aging:s1')!.status, 'open');
});

test('suggest add --kind hardening needs --where and a known kind', () => {
  const repo = mkRepo();
  const wt = newPlan(repo, 'nowhere');
  assert.throws(() => run(['suggest', 'add', '--kind', 'hardening', '--area', 'tests', '--text', 'x'], wt), /--where/);
  assert.throws(() => run(['suggest', 'add', '--kind', 'other', '--area', 'tests', '--where', 'a', '--text', 'x'], wt), /--kind/);
});

test("AE5: another plan finds a closed MVP plan's hardening item by path; records lists it", () => {
  const repo = mkRepo();
  const wt = newPlan(repo, 'first');
  hard(wt, 'src/api/routes.ts', 'routes have no tests');
  toLearn(wt, 'first');
  run(['close'], wt);
  const wt2 = newPlan(repo, 'second', 'standard');
  const hit = run(['suggest', 'list', '--open', '--for', 'src/api/**', '--json'], wt2).data!.suggestions as Row[];
  assert.deepEqual(hit.map((r) => r.key), ['first:s1']);
  const rec = (run(['records', '--json'], wt2).data!.records as { slug: string; followUps: { text: string }[] }[]).find((r) => r.slug === 'first')!;
  assert.deepEqual(rec.followUps.map((f) => f.text), ['routes have no tests']);
});

test('advancing an MVP plan to ship files a hardening item per finished task that skipped review', () => {
  const repo = mkRepo();
  const wt = newPlan(repo, 'ship');
  const task = (id: string, extra: object = {}) => ({ id, name: id.toUpperCase(), covers: [], blockedBy: [], scope: [`src/${id}/**`], complexity: 'standard', status: 'done', fixRound: 0, level: 'mvp', ...extra });
  edit(wt, 'ship', (s) => {
    s.stage = 'review';
    s.phases = [{ id: 'p', name: 'P', status: 'done', tasks: [task('a'), task('b', { risky: true }), task('c')] }];
    s.evidence.review = { result: 'pass', at: new Date().toISOString(), blocking: 0 };
  });
  run(['advance'], wt);
  const made = rows(wt);
  assert.deepEqual(made.map((r) => r.where), [['src/a/**'], ['src/c/**']]);
  assert.ok(made.every((r) => r.kind === 'hardening' && r.from === 'mvp' && /ran at MVP/.test(r.text)));
});

test('advancing a Standard plan to ship files nothing', () => {
  const repo = mkRepo();
  const wt = newPlan(repo, 'std', 'standard');
  edit(wt, 'std', (s) => {
    s.stage = 'review';
    s.phases = [{ id: 'p', name: 'P', status: 'done', tasks: [{ id: 'a', name: 'A', covers: [], blockedBy: [], scope: ['src/a/**'], complexity: 'standard', status: 'done', fixRound: 0, level: 'standard' }] }];
    s.evidence.review = { result: 'pass', at: new Date().toISOString(), blocking: 0 };
  });
  run(['advance'], wt);
  assert.equal(rows(wt).length, 0);
});

test('suggest add accepts --from security-review', () => {
  const repo = mkRepo();
  const wt = newPlan(repo, 'secsrc', 'standard');
  const r = run(['suggest', 'add', '--area', 'security', '--from', 'security-review', '--text', 'tighten the cookie flags'], wt);
  assert.equal(r.data!.key, 'secsrc:s1');
  assert.equal(rows(wt)[0].from, 'security-review');
});

test('merging hardening items keeps the kind and unions where; they stay out of the open cap', () => {
  const repo = mkRepo();
  const wt = newPlan(repo, 'hm');
  run(['suggest', 'add', '--kind', 'hardening', '--area', 'tests', '--where', 'src/a/**', '--text', 'a untested'], wt);
  run(['suggest', 'add', '--kind', 'hardening', '--area', 'tests', '--where', 'src/b/**', '--text', 'b untested'], wt);
  const m = run(['suggest', 'merge', 'hm:s1', 'hm:s2', '--area', 'tests', '--text', 'a and b untested'], wt);
  const merged = rows(wt).find((r) => r.key === m.data!.key)!;
  assert.equal(merged.kind, 'hardening');
  assert.deepEqual(merged.where, ['src/a/**', 'src/b/**']);
});

test('merging hardening items with an ordinary follow-up refuses', () => {
  const repo = mkRepo();
  const wt = newPlan(repo, 'hx');
  run(['suggest', 'add', '--kind', 'hardening', '--area', 'tests', '--where', 'src/a/**', '--text', 'a untested'], wt);
  run(['suggest', 'add', '--area', 'tests', '--text', 'ordinary'], wt);
  assert.throws(
    () => run(['suggest', 'merge', 'hx:s1', 'hx:s2', '--area', 'tests', '--text', 'mixed'], wt),
    (e: unknown) => e instanceof Refusal && /merge hardening items only with each other/.test(e.message),
  );
});

test('suggest list text marks hardening items', () => {
  const repo = mkRepo();
  const wt = newPlan(repo, 'hl');
  run(['suggest', 'add', '--kind', 'hardening', '--area', 'tests', '--where', 'src/a/**', '--text', 'a untested'], wt);
  run(['suggest', 'add', '--area', 'tests', '--text', 'ordinary'], wt);
  const lines = run(['suggest', 'list'], wt).message.split('\n');
  assert.match(lines.find((l) => l.includes('a untested'))!, /\[hardening\]/);
  assert.doesNotMatch(lines.find((l) => l.includes('ordinary'))!, /\[hardening\]/);
});
