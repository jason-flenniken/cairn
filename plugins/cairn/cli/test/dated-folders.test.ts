import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { planDirName, resolvePlanDir } from '../src/locate.ts';
import { run } from '../src/main.ts';
import { Refusal } from '../src/util.ts';
import { pd } from './plandir.ts';

let repo: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
// The CLI names folders by the local date (cli/src/locate.ts), so the test must too: UTC differs in the evening.
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

before(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-dated-')));
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

/** Rename a plan's folder on its branch, as a commit. */
function renameFolder(wt: string, from: string, to: string) {
  g(wt, 'mv', `docs/sdlc/plans/${from}`, `docs/sdlc/plans/${to}`);
  g(wt, 'commit', '-q', '-m', `rename ${from}`);
}

test('planDirName uses the local calendar day for a Date', () => {
  assert.equal(planDirName('demo', new Date(2026, 9, 21, 22, 30)), '2026-10-21-demo');
  assert.equal(planDirName('demo', new Date(2026, 0, 5, 0, 5)), '2026-01-05-demo');
});

test('planDirName dates the folder by the plan start', () => {
  assert.equal(planDirName('demo', '2026-10-21T08:30:00.000Z'), '2026-10-21-demo');
});

test('cairn new creates the dated folder on the plain-slug branch', () => {
  const r = run(['new', 'demo', '--title', 'Demo'], repo);
  const wt = r.data!.worktree as string;
  assert.equal(g(wt, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature/demo');
  assert.equal(r.data!.dir, join(wt, `docs/sdlc/plans/${today}-demo`));
  assert.ok(existsSync(join(wt, `docs/sdlc/plans/${today}-demo/state.json`)));
  assert.ok(!existsSync(join(wt, 'docs/sdlc/plans/demo')));
  assert.equal(g(wt, 'status', '--porcelain'), '', 'the new folder is committed');
  assert.equal(run(['status'], wt).data!.state && (run(['status'], wt).data!.state as { slug: string }).slug, 'demo');
});

test('a plan renamed to the dated form on its branch is found by status, next, decide and task start', () => {
  const wt = run(['new', 'shop', '--title', 'Shop'], repo).data!.worktree as string;
  renameFolder(wt, `${today}-shop`, '2026-10-01-shop');
  assert.equal(resolvePlanDir('shop', { root: wt }), 'docs/sdlc/plans/2026-10-01-shop');
  assert.equal((run(['status'], wt).data!.state as { slug: string }).slug, 'shop');
  assert.match(run(['next'], wt).message, /Shop/);
  run(['decide', 'Q?', 'A'], wt);
  assert.match(readFileSync(join(wt, 'docs/sdlc/plans/2026-10-01-shop/decisions.md'), 'utf8'), /### 1\. Q\?/);
  run(['advance'], wt);
  assert.equal(g(wt, 'status', '--porcelain'), '', 'plan commits land in the renamed folder');
  assert.match(g(wt, 'show', '--stat', '--format=%s', 'HEAD'), /advance to prd[\s\S]*2026-10-01-shop/);
  assert.throws(() => run(['task', 'start', 'nope'], wt), (e: unknown) => e instanceof Refusal && /no task "nope"|plan is in/.test(e.message));
  const row = (run(['status', '--all'], repo).data!.plans as { state: { slug: string }; dir: string }[]).find((p) => p.state.slug === 'shop');
  assert.equal(row?.dir, join(wt, 'docs/sdlc/plans/2026-10-01-shop'));
});

test('a branch whose tree still has the old folder resolves to it, and status --all lists it from the branch', () => {
  const wt = run(['new', 'legacy-app', '--title', 'Legacy app'], repo).data!.worktree as string;
  renameFolder(wt, `${today}-legacy-app`, 'legacy-app');
  g(repo, 'worktree', 'remove', '--force', wt); // only the branch remains
  assert.equal(resolvePlanDir('legacy-app', { ref: 'feature/legacy-app', cwd: repo }), 'docs/sdlc/plans/legacy-app');
  const plans = run(['status', '--all'], repo).data!.plans as { state: { slug: string }; live: boolean; dir: string }[];
  const rows = plans.filter((p) => p.state.slug === 'legacy-app');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.live, false);
  assert.ok(rows[0]!.dir.startsWith('/'), 'dir is absolute even when not checked out');
  assert.match(run(['resume', 'legacy-app'], repo).message, /lives in/);
});

test('a checkout holding both the old and the dated folder lists the plan once and prefers the dated one', () => {
  const wt = run(['new', 'twin', '--title', 'Twin'], repo).data!.worktree as string;
  const dated = pd(wt, 'twin');
  const old = join(dirname(dated), 'twin');
  mkdirSync(old, { recursive: true });
  writeFileSync(join(old, 'state.json'), readFileSync(join(dated, 'state.json')));
  assert.equal(resolvePlanDir('twin', { root: wt }), `docs/sdlc/plans/${today}-twin`);
  const rows = (run(['status', '--all'], repo).data!.plans as { state: { slug: string } }[]).filter((p) => p.state.slug === 'twin');
  assert.equal(rows.length, 1);
});

test('a slug only matches its exact folder name, never another plan whose name ends the same', () => {
  const wt = run(['new', 'pet-shop', '--title', 'Pet shop'], repo).data!.worktree as string;
  renameFolder(wt, `${today}-pet-shop`, '2026-10-01-pet-shop');
  // `shop` lives on its own branch, so look in the pet-shop checkout: only pet-shop's folder is there.
  assert.equal(resolvePlanDir('shop', { root: wt }), undefined);
  assert.equal(resolvePlanDir('shop', { ref: 'feature/pet-shop', cwd: repo }), undefined);
  assert.equal(resolvePlanDir('pet-shop', { root: wt }), 'docs/sdlc/plans/2026-10-01-pet-shop');
  // and a decoy folder with a longer name beside the real one does not win
  const dir = join(wt, 'docs/sdlc/plans');
  mkdirSync(join(dir, '2026-10-01-big-pet-shop'), { recursive: true });
  writeFileSync(join(dir, '2026-10-01-big-pet-shop/state.json'), '{}');
  assert.equal(resolvePlanDir('pet-shop', { root: wt }), 'docs/sdlc/plans/2026-10-01-pet-shop');
});
