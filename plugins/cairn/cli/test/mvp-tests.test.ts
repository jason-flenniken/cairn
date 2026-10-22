import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { run } from '../src/main.ts';
import { testsGate } from '../src/shared.ts';
import type { State } from '../src/types.ts';
import { Refusal } from '../src/util.ts';
import { pd } from './plandir.ts';

let repo: string;
let sentinel: string;
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const write = (p: string, s: string) => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, s);
};
const red = () => writeFileSync(sentinel, 'x');
const green = () => rmSync(sentinel, { force: true });

before(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-mvptests-')));
  sentinel = `${repo}-RED`;
  g(repo, 'init', '-q', '-b', 'main');
  write(join(repo, 'README.md'), 'hi\n');
  // Noisy output first, so the item must keep only the summary line.
  const cmd = `echo "TOKEN=hun""ter2"; if [ -f ${sentinel} ]; then echo "1 failed, 2 passed"; exit 1; fi; echo "3 passed"`;
  write(join(repo, '.sdlc/config.json'), JSON.stringify({ test: cmd, maxParallel: 3 }));
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(sentinel, { force: true });
});

const PLAN = `## Goal
g
## Architecture
a
## Phases
\`\`\`yaml cairn-tasks
phases:
  - id: core
    name: Core
    tasks:
      - { id: one, name: One, kind: prefactor, covers: [], scope: ["src/one/**"] }
      - { id: two, name: Two, kind: prefactor, covers: [], scope: ["src/two/**"] }
\`\`\`
`;
/** Edit a plan's saved record directly, to reach a stage without the approvals. */
function edit(wt: string, slug: string, fn: (s: Record<string, any>) => void) {
  const f = join(pd(wt, slug), 'state.json');
  const s = JSON.parse(readFileSync(f, 'utf8'));
  fn(s);
  writeFileSync(f, JSON.stringify(s, null, 2));
}
/** A plan at the execute stage with two tasks. */
function planAt(slug: string, level: string): string {
  green();
  const wt = run(['new', slug, '--title', slug, '--level', level], repo).data!.worktree as string;
  edit(wt, slug, (s) => (s.stage = 'plan'));
  write(join(pd(wt, slug), 'plan.md'), PLAN);
  run(['plan', 'load'], wt);
  edit(wt, slug, (s) => (s.stage = 'execute'));
  return wt;
}
/** Start a task, commit its work, merge it, and run `task done`. */
function finish(wt: string, slug: string, id: string) {
  const tw = run(['task', 'start', id], wt).data!.worktree as string;
  write(join(tw, `src/${id}/index.ts`), `export const ${id} = 1;\n`);
  g(tw, 'add', '-A');
  g(tw, 'commit', '-q', '-m', id);
  g(wt, 'merge', '-q', '--no-ff', '-m', `merge ${id}`, `task/${slug}/${id}`);
  return run(['task', 'done', id], wt);
}
type Row = { key: string; text: string; where: string[]; kind?: string; from: string; status: string };
/** This plan's hardening items (the listing spans every plan in the repository). */
const items = (wt: string, slug: string): Row[] => (run(['suggest', 'list', '--json'], wt).data!.suggestions as Row[]).filter((r) => r.kind === 'hardening' && r.key.startsWith(`${slug}:`));
const saved = (wt: string, slug: string) => JSON.parse(readFileSync(join(pd(wt, slug), 'state.json'), 'utf8'));

test('AE1: MVP task done with a failing suite succeeds and files one hardening item; phase finish adds no second', () => {
  const wt = planAt('ae1', 'mvp');
  red();
  assert.match(finish(wt, 'ae1', 'one').message, /Task "One" done/);
  const made = items(wt, 'ae1');
  assert.equal(made.length, 1);
  assert.deepEqual(made[0].where, ['src/one/**']);
  assert.equal(made[0].from, 'mvp');
  assert.match(made[0].text, /^Tests failing: `.*` → 1 failed, 2 passed$/);
  assert.ok(!readFileSync(join(pd(wt, 'ae1'), 'state.json'), 'utf8').includes('hunter2'), 'raw output never reaches the saved record');

  finish(wt, 'ae1', 'two');
  run(['phase', 'finish'], wt);
  assert.equal(items(wt, 'ae1').length, 1, 'the same command fails again without a second item');
  assert.ok(saved(wt, 'ae1').log.some((l: any) => l.event === 'warning: phase finish'));
});

test('a later green run resolves the open test-failure item', () => {
  const wt = planAt('heal', 'mvp');
  red();
  finish(wt, 'heal', 'one');
  assert.equal(items(wt, 'heal')[0].status, 'open');
  green();
  finish(wt, 'heal', 'two');
  assert.equal(items(wt, 'heal')[0].status, 'closed');
});

test('Standard task done with a failing suite still refuses', () => {
  const wt = planAt('std', 'standard');
  red();
  assert.throws(() => finish(wt, 'std', 'one'), (e: unknown) => e instanceof Refusal && /tests are not green/.test(e.message));
  assert.equal(items(wt, 'std').length, 0);
});

test('a run that never executed still refuses at MVP', () => {
  const s = { slug: 'x', level: 'mvp', log: [], suggestions: [], phases: [] } as unknown as State;
  assert.throws(
    () => testsGate({ ok: false, ran: false, cmd: 'npm test', tail: 'not run' }, s, 'task done', {}),
    (e: unknown) => e instanceof Refusal && /tests are not green/.test(e.message),
  );
  assert.equal(s.suggestions!.length, 0);
});

test('cairn test: MVP red opens the item and succeeds; Standard red only reports', () => {
  const wt = planAt('ct', 'mvp');
  red();
  assert.match(run(['test'], wt).message, /RED/);
  assert.equal(items(wt, 'ct').length, 1);
  run(['test'], wt);
  assert.equal(items(wt, 'ct').length, 1, 'a repeat only logs');
  green();
  assert.match(run(['test'], wt).message, /green/i);
  assert.equal(items(wt, 'ct')[0].status, 'closed');

  const wt2 = planAt('ct2', 'standard');
  red();
  assert.match(run(['test'], wt2).message, /RED/);
  assert.equal(items(wt2, 'ct2').length, 0);
});

test('MVP close with a red suite closes, and the failure shows in status --json', () => {
  const wt = planAt('cl', 'mvp');
  edit(wt, 'cl', (s) => (s.stage = 'learn'));
  copyFileSync(join(import.meta.dirname, '../../templates/record.md'), join(pd(wt, 'cl'), 'RECORD.md'));
  red();
  assert.match(run(['close'], wt).message, /Closed/);
  const known = run(['status', '--json'], wt).data!.knownFailures as { text: string }[];
  assert.equal(known.length, 1);
  assert.match(known[0].text, /1 failed, 2 passed/);
});

test('U10: MVP status --json groups this plan\'s hardening items by area and names the failing command', () => {
  const wt = planAt('rec', 'mvp');
  const common = ['--text', 'No tests cover the parser', '--where', 'src/one/**'];
  run(['suggest', 'add', '--area', 'security', ...common, '--kind', 'hardening'], wt);
  run(['suggest', 'add', '--area', 'docs', ...common, '--kind', 'hardening'], wt);
  run(['suggest', 'add', '--area', 'docs', ...common, '--kind', 'hardening'], wt);
  red();
  finish(wt, 'rec', 'one');
  const d = run(['status', '--json'], wt).data!;
  assert.deepEqual(d.hardeningByArea, { security: 1, docs: 2, tests: 1 });
  const known = d.knownFailures as { command: string }[];
  assert.equal(known.length, 1);
  assert.match(known[0].command, /echo/);
  assert.equal(d.level, 'mvp');
  assert.ok(d.timing);
});
