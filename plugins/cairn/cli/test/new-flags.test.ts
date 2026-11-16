import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { run } from '../src/main.ts';
import { Refusal } from '../src/util.ts';

const repos: string[] = [];
after(() => repos.forEach((r) => rmSync(r, { recursive: true, force: true })));

function makeRepo(config?: object): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-newflags-')));
  repos.push(repo);
  const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  if (config) {
    mkdirSync(join(repo, '.cairn'), { recursive: true });
    writeFileSync(join(repo, '.cairn/config.json'), JSON.stringify(config));
  }
  g('add', '-A');
  g('commit', '-q', '-m', 'init');
  return repo;
}

const refusal = (re: RegExp) => (e: unknown) => e instanceof Refusal && re.test(e.message);
const branches = (repo: string) => execFileSync('git', ['branch', '--list'], { cwd: repo, encoding: 'utf8' });

test('a feature plan without --level is refused, and nothing is created', () => {
  const repo = makeRepo();
  assert.throws(() => run(['new', 'a', '--title', 'A', '--no-proofs'], repo), refusal(/--level/));
  assert.doesNotMatch(branches(repo), /feature\/a/);
});

test('a feature plan without --proofs or --no-proofs is refused', () => {
  const repo = makeRepo();
  assert.throws(() => run(['new', 'b', '--title', 'B', '--level', 'standard'], repo), refusal(/--proofs or --no-proofs/));
  assert.doesNotMatch(branches(repo), /feature\/b/);
});

test('the refusal names the questions to ask and the rerun', () => {
  const repo = makeRepo();
  try {
    run(['new', 'c', '--title', 'C'], repo);
    assert.fail('expected a refusal');
  } catch (e) {
    assert.ok(e instanceof Refusal);
    assert.match(e.message, /--level/);
    assert.match(e.message, /--proofs or --no-proofs/);
    const text = JSON.stringify(e);
    assert.match(text, /level question and the proofs question/);
    assert.match(text, /cairn new c again/);
  }
});

test('config defaults do not answer for the user', () => {
  const repo = makeRepo({ defaultLevel: 'polished', proofs: 'on' });
  assert.throws(() => run(['new', 'd', '--title', 'D'], repo), refusal(/--level/));
});

test('both flags given: the plan starts with exactly those answers', () => {
  const repo = makeRepo({ defaultLevel: 'polished', proofs: 'on' });
  const r = run(['new', 'e', '--title', 'E', '--level', 'mvp', '--no-proofs'], repo);
  assert.equal(r.data!.level, 'mvp');
  assert.equal(r.data!.proofs, false);
  const p = run(['new', 'f', '--title', 'F', '--level', 'polished', '--proofs'], repo);
  assert.equal(p.data!.level, 'polished');
  assert.equal(p.data!.proofs, true);
});

test('an invalid level and both proofs flags are still refused', () => {
  const repo = makeRepo();
  assert.throws(() => run(['new', 'g', '--level', 'fast', '--no-proofs'], repo), refusal(/not a level/));
  assert.throws(() => run(['new', 'h', '--level', 'mvp', '--proofs', '--no-proofs'], repo), /not both/);
});

test('a fix plan needs neither flag', () => {
  const repo = makeRepo();
  const r = run(['new', 'crash', '--track', 'fix', '--title', 'Crash'], repo);
  assert.equal(r.data!.level, null);
  assert.equal(r.data!.proofs, null);
});
