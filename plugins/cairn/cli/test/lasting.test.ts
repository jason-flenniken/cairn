import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { parseDecisions } from '../src/commands/plans.ts';
import { run } from '../src/main.ts';
import { Refusal } from '../src/util.ts';
import { pd } from './plandir.ts';

let repo: string;
let wt: string;
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const refused = (cwd: string, pattern: RegExp, ...argv: string[]) => assert.throws(() => run(argv, cwd), (e: unknown) => e instanceof Refusal && pattern.test(e.message));
const state = () => JSON.parse(readFileSync(join(pd(wt, 'memo'), 'state.json'), 'utf8'));
const decisionsMd = () => readFileSync(join(pd(wt, 'memo'), 'decisions.md'), 'utf8');

before(() => {
  for (const k of ['GIT_AUTHOR_NAME', 'GIT_COMMITTER_NAME']) process.env[k] = 't';
  for (const k of ['GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_EMAIL']) process.env[k] = 't@t';
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-lasting-')));
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
  wt = run(['new', 'memo', '--title', 'Memo'], repo).data!.worktree as string;
});
after(() => rmSync(repo, { recursive: true, force: true }));

test('lasting decision is stored and annotated', () => {
  run(['decide', 'Q1', 'A1', '--lasting', '--areas', 'locate'], wt);
  const l = state().lasting;
  assert.equal(l[0].n, 1);
  assert.deepEqual(l[0].areas, ['locate']);
  assert.match(decisionsMd(), /\*\*Lasting:\*\* areas: locate/);
});

test('promote flags an existing decision', () => {
  run(['decide', 'Q2', 'A2', '--why', 'because'], wt);
  assert.equal(state().lasting.length, 1);
  run(['decide', '--promote', '2', '--paths', 'src/**'], wt);
  const l = state().lasting;
  assert.equal(l[1].n, 2);
  assert.equal(l[1].why, 'because');
  assert.deepEqual(l[1].paths, ['src/**']);
  assert.match(decisionsMd(), /\*\*Why:\*\* because\n\*\*Lasting:\*\* paths: src\/\*\*\n_/);
  refused(wt, /already lasting/, 'decide', '--promote', '2', '--paths', 'x/**');
  refused(wt, /no decision 9/, 'decide', '--promote', '9', '--paths', 'x/**');
});

test('refuses lasting without scope', () => {
  refused(wt, /needs --areas or --paths/, 'decide', 'Q', 'A', '--lasting');
  refused(wt, /needs --areas or --paths/, 'decide', '--promote', '1');
  assert.equal(parseDecisions(decisionsMd()).length, 2, 'nothing was appended');
});

test('refuses unknown replaces', () => {
  refused(wt, /2026-01-01-nope/, 'decide', 'Q', 'A', '--lasting', '--paths', 'src/**', '--replaces', '2026-01-01-nope');
  assert.equal(parseDecisions(decisionsMd()).length, 2);
});

test('refuses unknown area only when area docs exist', () => {
  mkdirSync(join(wt, 'docs/cairn/system'), { recursive: true });
  writeFileSync(join(wt, 'docs/cairn/system/locate.md'), '---\narea: Locate\nsummary: s\npaths: [src/**]\n---\nbody\n');
  run(['decide', 'Q4', 'A4', '--lasting', '--areas', 'locate'], wt);
  refused(wt, /unknown area nope/, 'decide', 'Q5', 'A5', '--lasting', '--areas', 'locate,nope');
});

test('--file accepts lasting fields', () => {
  writeFileSync(join(wt, 'd.json'), JSON.stringify({ question: 'QF', answer: 'AF', lasting: true, paths: ['lib/**'] }));
  run(['decide', '--file', 'd.json'], wt);
  assert.deepEqual(state().lasting.at(-1).paths, ['lib/**']);
});

test('backfill off a plan publishes directly', () => {
  run(['decide', 'Q3', 'A3', '--lasting', '--paths', 'src/**', '--plan', 'old', '--date', '2026-10-01'], repo);
  const f = readFileSync(join(repo, 'docs/cairn/decisions/2026-10-01-q3.md'), 'utf8');
  assert.match(f, /plan: old/);
  assert.match(f, /\*\*Decision:\*\* A3/);
  assert.throws(() => run(['decide', 'Q', 'A'], repo), /not on a plan branch/);
});

test('parseDecisions reads appendDecision output', () => {
  const md = '# Decisions\n\n### 1. Q one\n**Decision:** A one\n**Why:** W one\n**Lasting:** areas: a\n_2026-10-27 10:00_\n\n### 2. Q two\n**Decision:** A two\n_2026-10-27 10:01_\n';
  assert.deepEqual(parseDecisions(md), [
    { n: 1, question: 'Q one', answer: 'A one', why: 'W one' },
    { n: 2, question: 'Q two', answer: 'A two' },
  ]);
});
