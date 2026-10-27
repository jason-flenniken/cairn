import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { plansDirsIn, resolvePlanDir } from '../src/locate.ts';
import { run } from '../src/main.ts';
import { newState } from '../src/state.ts';

let repo: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

before(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-legacy-')));
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

/** A closed plan committed under the legacy docs/sdlc root on its own branch, with no worktree. */
function legacyBranch(slug: string, title: string) {
  const branch = `feature/${slug}`;
  const wt = join(repo, '..', `legacy-${slug}-${process.pid}`);
  g(repo, 'worktree', 'add', '-q', '-b', branch, wt, 'main');
  const s = newState(slug, title, 'feature', branch, 'main');
  s.stage = 'closed';
  const dir = join(wt, `docs/sdlc/plans/2026-10-01-${slug}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(s, null, 2) + '\n');
  g(wt, 'add', '-A');
  g(wt, 'commit', '-q', '-m', 'legacy plan');
  return { branch, wt };
}

test('new plans land under docs/cairn/plans', () => {
  const r = run(['new', 'alpha', '--title', 'A'], repo);
  assert.match(r.data!.dir as string, /docs\/cairn\/plans\/\d{4}-\d{2}-\d{2}-alpha$/);
});

test('a legacy plan branch with no worktree is still listed', () => {
  const { wt } = legacyBranch('old', 'Old');
  g(repo, 'worktree', 'remove', '--force', wt);
  assert.equal(resolvePlanDir('old', { ref: 'feature/old', cwd: repo }), 'docs/sdlc/plans/2026-10-01-old');
  const plans = run(['status', '--all', '--json'], repo).data!.plans as { state: { slug: string } }[];
  assert.ok(plans.some((p) => p.state.slug === 'old'));
  assert.match(run(['records'], repo).message, /Old/);
});

test('a legacy plan checked out in a worktree resolves', () => {
  const { wt } = legacyBranch('older', 'Older');
  assert.equal(resolvePlanDir('older', { root: wt }), 'docs/sdlc/plans/2026-10-01-older');
  assert.equal((run(['status', '--json'], wt).data!.state as { slug: string }).slug, 'older');
});

test('the new root wins when a slug sits under both', () => {
  const { wt } = legacyBranch('twice', 'Twice');
  const legacy = join(wt, 'docs/sdlc/plans/2026-10-01-twice');
  const fresh = join(wt, 'docs/cairn/plans/2026-10-02-twice');
  mkdirSync(fresh, { recursive: true });
  writeFileSync(join(fresh, 'state.json'), readFileSync(join(legacy, 'state.json')));
  assert.equal(resolvePlanDir('twice', { root: wt }), 'docs/cairn/plans/2026-10-02-twice');
  assert.deepEqual(plansDirsIn(wt), [join(wt, 'docs/cairn/plans'), join(wt, 'docs/sdlc/plans')]);
  g(wt, 'add', '-A');
  g(wt, 'commit', '-q', '-m', 'both');
  assert.equal(resolvePlanDir('twice', { ref: 'feature/twice', cwd: repo }), 'docs/cairn/plans/2026-10-02-twice');
});

test('product init writes docs/cairn/product/PRD.md', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-prod-')));
  try {
    g(dir, 'init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'README.md'), 'x\n');
    g(dir, 'add', '-A');
    g(dir, 'commit', '-q', '-m', 'init');
    run(['product', 'init'], dir);
    assert.ok(existsSync(join(dir, 'docs/cairn/product/PRD.md')));
    assert.ok(!existsSync(join(dir, 'docs/sdlc/product')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('render writes docs/cairn/OVERVIEW.md on main', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-render-')));
  try {
    g(dir, 'init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'README.md'), 'x\n');
    g(dir, 'add', '-A');
    g(dir, 'commit', '-q', '-m', 'init');
    run(['render'], dir);
    assert.ok(existsSync(join(dir, 'docs/cairn/OVERVIEW.md')));
    assert.ok(!existsSync(join(dir, 'docs/sdlc/OVERVIEW.md')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
