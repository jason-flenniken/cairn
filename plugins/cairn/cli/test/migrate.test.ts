import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
  assert.equal(hookSessionStart({ cwd: repo }), '');
});

test('refuses with an in-flight plan', () => {
  run(['new', 'live', '--title', 'L'], repo);
  put('.sdlc/extra.txt', 'x');
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
    g(r2, 'rm', '-q', '-f', '.sdlc/config.json');
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
