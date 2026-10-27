import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { hookSessionStart } from '../src/commands.ts';
import { run } from '../src/main.ts';
import { Refusal } from '../src/util.ts';

let repo: string;
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const put = (rel: string, s: string) => {
  mkdirSync(join(repo, rel, '..'), { recursive: true });
  writeFileSync(join(repo, rel), s);
};
const state = JSON.stringify({ slug: 'old', title: 'Old', stage: 'closed', branch: 'feature/old', base: 'main' });

before(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-migrate-')));
  g(repo, 'init', '-q', '-b', 'main');
  put('README.md', 'hi\n');
  put('.sdlc/config.json', '{}\n');
  put('docs/sdlc/plans/2026-10-01-old/state.json', state);
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

test('session-start hints on a legacy repo', () => {
  assert.match(hookSessionStart({ cwd: repo }), /cairn migrate/);
});

test('refuses on a dirty tree', () => {
  put('scratch.txt', 'x');
  assert.throws(() => run(['migrate'], repo), (e: unknown) => e instanceof Refusal && /uncommitted/.test(e.message));
  rmSync(join(repo, 'scratch.txt'));
});

test('moves both roots and commits', () => {
  const r = run(['migrate'], repo);
  assert.match(r.message, /Moved \.sdlc\/ to \.cairn\/ and docs\/sdlc\/ to docs\/cairn\//);
  assert.ok(existsSync(join(repo, '.cairn/config.json')));
  assert.ok(existsSync(join(repo, 'docs/cairn/plans/2026-10-01-old/state.json')));
  assert.ok(!existsSync(join(repo, '.sdlc')) && !existsSync(join(repo, 'docs/sdlc')));
  assert.equal(g(repo, 'log', '-1', '--format=%s'), 'cairn: move .sdlc to .cairn and docs/sdlc to docs/cairn');
  assert.equal(g(repo, 'status', '--porcelain'), '');
});

test('second run is a no-op', () => {
  assert.match(run(['migrate'], repo).message, /Nothing to migrate/);
  assert.doesNotMatch(hookSessionStart({ cwd: repo }), /cairn migrate/); // the closed plan now shows in the changelog
});

test('refuses with an in-flight plan', () => {
  run(['new', 'live', '--title', 'L'], repo);
  put('.sdlc/config.json', '{}');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'legacy leftover');
  assert.throws(() => run(['migrate'], repo), (e: unknown) => e instanceof Refusal && /live/.test(e.message));
});

test('merges into an existing new root, refusing on a name clash', () => {
  const r2 = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-migrate2-')));
  try {
    const p = (rel: string, s: string) => {
      mkdirSync(join(r2, rel, '..'), { recursive: true });
      writeFileSync(join(r2, rel), s);
    };
    g(r2, 'init', '-q', '-b', 'main');
    p('.cairn/config.json', '{}');
    p('.sdlc/config.json', '{}');
    g(r2, 'add', '-A');
    g(r2, 'commit', '-q', '-m', 'init');
    assert.throws(() => run(['migrate'], r2), (e: unknown) => e instanceof Refusal && /config\.json/.test(e.message));
    g(r2, 'rm', '-q', '-f', '.cairn/config.json');
    p('.cairn/keep.md', 'k');
    p('.sdlc/notes.md', 'n');
    p('.gitignore', 'ignored.md\n');
    p('.sdlc/notes.md', 'n');
    g(r2, 'add', '-A');
    g(r2, 'commit', '-q', '-m', 'notes');
    p('.sdlc/ignored.md', 'u');
    run(['migrate'], r2);
    assert.ok(existsSync(join(r2, '.cairn/notes.md')) && existsSync(join(r2, '.cairn/ignored.md')));
  } finally {
    rmSync(r2, { recursive: true, force: true });
  }
});

function scratch(files: Record<string, string>): { r: string; done: () => void } {
  const r = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-migrate3-')));
  g(r, 'init', '-q', '-b', 'main');
  for (const [rel, c] of Object.entries(files)) {
    mkdirSync(join(r, rel, '..'), { recursive: true });
    writeFileSync(join(r, rel), c);
  }
  g(r, 'add', '-A');
  g(r, 'commit', '-q', '-m', 'init');
  return { r, done: () => rmSync(r, { recursive: true, force: true }) };
}

test('a clash under docs/ refuses before anything moves', () => {
  const { r, done } = scratch({ '.sdlc/config.json': '{}', 'docs/sdlc/plans/a/prd.md': '1', 'docs/sdlc/product/PRD.md': 'p', 'docs/cairn/plans/a/prd.md': '2' });
  try {
    assert.throws(() => run(['migrate'], r), (e: unknown) => e instanceof Refusal && /docs\/cairn\/plans\/a\/prd\.md/.test(e.message));
    assert.ok(existsSync(join(r, '.sdlc/config.json')) && !existsSync(join(r, '.cairn')));
    assert.equal(g(r, 'status', '--porcelain'), '');
  } finally {
    done();
  }
});

test('plans from both layouts merge under docs/cairn/plans in one commit', () => {
  const { r, done } = scratch({ 'docs/sdlc/product/PRD.md': 'p', 'docs/sdlc/plans/2026-10-01-old/prd.md': '1', 'docs/cairn/plans/2026-10-27-new/prd.md': '2' });
  try {
    run(['migrate'], r);
    assert.ok(existsSync(join(r, 'docs/cairn/plans/2026-10-01-old/prd.md')) && existsSync(join(r, 'docs/cairn/plans/2026-10-27-new/prd.md')));
    assert.ok(!existsSync(join(r, 'docs/sdlc')));
    assert.equal(g(r, 'rev-list', '--count', 'HEAD'), '2');
    assert.equal(g(r, 'status', '--porcelain'), '');
  } finally {
    done();
  }
});

test('another tool\'s docs/sdlc and .sdlc are neither nagged about nor moved', () => {
  const { r, done } = scratch({ 'docs/sdlc/spec.md': 'mine', '.sdlc/notes.md': 'mine too' });
  try {
    assert.equal(hookSessionStart({ cwd: r }), '');
    assert.match(run(['migrate'], r).message, /Nothing to migrate/);
    assert.ok(existsSync(join(r, 'docs/sdlc/spec.md')) && existsSync(join(r, '.sdlc/notes.md')) && !existsSync(join(r, 'docs/cairn')));
  } finally {
    done();
  }
});

test('only cairn\'s legacy root moves when the other belongs to someone else', () => {
  const { r, done } = scratch({ '.sdlc/config.json': '{}', 'docs/sdlc/spec.md': 'mine' });
  try {
    assert.match(run(['migrate'], r).message, /Moved \.sdlc\/ to \.cairn\/\./);
    assert.ok(existsSync(join(r, 'docs/sdlc/spec.md')) && existsSync(join(r, '.cairn/config.json')));
  } finally {
    done();
  }
});

test('a symlink in the legacy tree is a clash, not something to move over', () => {
  const { r, done } = scratch({ '.sdlc/config.json': '{}', 'real/x.md': 'x' });
  try {
    symlinkSync(join(r, 'real'), join(r, '.cairn'));
    g(r, 'add', '-A');
    g(r, 'commit', '-q', '-m', 'link');
    assert.throws(() => run(['migrate'], r), (e: unknown) => e instanceof Refusal && /\.cairn/.test(e.message));
    assert.ok(existsSync(join(r, '.sdlc/config.json')));
  } finally {
    done();
  }
});
