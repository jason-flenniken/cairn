import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { run } from '../src/main.ts';
import { Refusal } from '../src/util.ts';
import { pd } from './plandir.ts';

let repo: string;
let wt: string;
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

before(() => {
  for (const k of ['GIT_AUTHOR_NAME', 'GIT_COMMITTER_NAME']) process.env[k] = 't';
  for (const k of ['GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_EMAIL']) process.env[k] = 't@t';
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-removed-')));
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
  wt = run(['new', 'gone', '--title', 'Gone'], repo).data!.worktree as string;
});
after(() => rmSync(repo, { recursive: true, force: true }));

const REMOVED = /was removed; the changelog in docs\/cairn\/OVERVIEW\.md replaces it\./;
const removed = (cwd: string, ...argv: string[]) =>
  assert.throws(
    () => run(argv, cwd),
    (e: unknown) => {
      assert.ok(e instanceof Refusal, `expected a refusal, got ${e}`);
      assert.match(e.message, REMOVED);
      return true;
    },
  );
const decisions = () => readFileSync(join(pd(wt, 'gone'), 'decisions.md'), 'utf8');

test('cairn recall and cairn area refuse, with or without a plan', () => {
  removed(wt, 'recall', 'x');
  removed(repo, 'recall', 'x');
  removed(wt, 'area', 'skip', 'a', '--note', 'n');
  removed(wt, 'area', 'skip', '--uncovered', '--note', 'n');
});

test('the removed decide options refuse, and nothing is recorded', () => {
  const before = decisions();
  removed(wt, 'decide', 'q', 'a', '--lasting', '--areas', 'a');
  removed(wt, 'decide', '--promote', '1', '--areas', 'a');
  removed(wt, 'decide', 'q', 'a', '--replaces', 'x');
  removed(wt, 'decide', 'q', 'a', '--paths', 'src/**');
  removed(wt, 'decide', 'q', 'a', '--plan', 'map', '--date', '2026-01-01');
  assert.equal(decisions(), before);
});

test('--lasting does not swallow the next argument before it is refused', () => {
  removed(wt, 'decide', '--lasting', 'q', 'a');
});

test('a decision file with a lasting key is refused, one without records', () => {
  for (const key of ['lasting', 'areas', 'paths', 'replaces']) {
    const file = join(repo, `d-${key}.json`);
    writeFileSync(file, JSON.stringify({ question: 'q', answer: 'a', [key]: key === 'lasting' ? true : key === 'replaces' ? 'x' : ['a'] }));
    removed(wt, 'decide', '--file', file);
  }
  const plain = join(repo, 'plain.json');
  writeFileSync(plain, JSON.stringify({ question: 'from file', answer: 'yes', why: 'because' }));
  run(['decide', '--file', plain], wt);
  assert.match(decisions(), /### \d+\. from file\n\*\*Decision:\*\* yes\n\*\*Why:\*\* because/);
});

test('a plain decide still records, with no Lasting line', () => {
  const r = run(['decide', 'Which store?', 'Use files', '--why', 'simple'], wt);
  assert.match(r.message, /^Recorded decision \d+: Use files$/);
  const md = decisions();
  assert.match(md, new RegExp(`### ${r.data!.number}\\. Which store\\?\\n\\*\\*Decision:\\*\\* Use files\\n\\*\\*Why:\\*\\* simple\\n_`));
  assert.doesNotMatch(md, /Lasting/);
});

test('help no longer lists the removed commands', () => {
  const usage = run(['help'], repo).message;
  assert.doesNotMatch(usage, /recall|area skip|--lasting|--promote|--replaces/);
});
