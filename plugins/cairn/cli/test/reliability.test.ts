import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parsePlan } from '../src/plan-parse.ts';
import { criticalPath } from '../src/ready.ts';
import { runTests } from '../src/shared.ts';
import { loadState, parseState } from '../src/state.ts';
import type { Config, Phase, Task } from '../src/types.ts';
import { CliError, withLock, writeAtomic } from '../src/util.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'cairn-rel-'));

// ---------- Atomic writes ----------

test('writeAtomic replaces a file whole and leaves no temp file behind', () => {
  const d = tmp();
  const p = join(d, 'state.json');
  writeAtomic(p, 'old\n');
  writeAtomic(p, 'new\n');
  assert.equal(readFileSync(p, 'utf8'), 'new\n');
  assert.deepEqual(readdirSync(d), ['state.json']);
});

test('a write that fails before the rename keeps the old file readable and cleans up its temp file', () => {
  const d = tmp();
  const p = join(d, 'target');
  mkdirSync(join(p, 'child'), { recursive: true }); // renaming a file over a non-empty folder fails
  assert.throws(() => writeAtomic(p, 'x'));
  assert.ok(existsSync(join(p, 'child')), 'the old target is untouched');
  assert.deepEqual(readdirSync(d), ['target'], 'no temp file is left');
});

// ---------- State boundary ----------

test('a damaged or future state file fails by name instead of later, by accident', () => {
  const d = tmp();
  const good = { schema: 1, slug: 's', branch: 'feature/s', stage: 'prd', phases: [], approvals: {} };
  writeFileSync(join(d, 'state.json'), '{"schema": 1, "slu');
  assert.throws(() => loadState(d), (e) => e instanceof CliError && /not valid JSON/.test(e.message));
  writeFileSync(join(d, 'state.json'), JSON.stringify({ ...good, schema: 2 }));
  assert.throws(() => loadState(d), /unsupported state schema 2/);
  writeFileSync(join(d, 'state.json'), JSON.stringify({ ...good, phases: {} }));
  assert.throws(() => loadState(d), /damaged: missing or wrong phases/);
  writeFileSync(join(d, 'state.json'), JSON.stringify({ ...good, phases: [{ id: 'p' }] }));
  assert.throws(() => loadState(d), /a phase has no task list/);
  writeFileSync(join(d, 'state.json'), JSON.stringify(good));
  assert.equal(loadState(d).slug, 's');
  const { schema: _schema, ...unversioned } = good;
  assert.equal(parseState(JSON.stringify(unversioned)).slug, 's', 'listing old plans accepts a missing schema field');
  assert.throws(() => parseState('[]'), /not a plan state object/);
});

// ---------- Plan parsing ----------

const PRD = '## Functional requirements\n- FR-01 add\n';
const plan = (yaml: string) => `## Goal\ng\n## Architecture\na\n## Global constraints\nc\n## Review focus\nr\n## Phases\n\`\`\`yaml cairn-tasks\n${yaml}\n\`\`\`\n`;
const problemsOf = (yaml: string) => parsePlan(plan(yaml), PRD).problems.join('\n');

test('malformed task shapes become problems, never exceptions', () => {
  assert.match(problemsOf('phases:\n  - id: one\n    tasks: {}'), /phase "one": `tasks` must be a list of tasks/);
  assert.match(problemsOf('phases:\n  - id: one\n    tasks: nope'), /`tasks` must be a list of tasks/);
  assert.match(problemsOf('phases:\n  - id: one\n    tasks:'), /phase "one" has no tasks/);
  assert.match(problemsOf('phases:\n  - id: one\n    tasks: [null, "x"]'), /each task must be a mapping/);
  const t = (field: string) => `phases:\n  - id: one\n    tasks:\n      - id: a\n        covers: [FR-01]\n        scope: [src/**]\n        ${field}`;
  assert.match(problemsOf(t('blocked_by: b')), /task "a": `blocked_by` must be a list of strings/);
  assert.match(problemsOf(t('blocked_by: {b: 1}')), /`blocked_by` must be a list of strings/);
  assert.match(problemsOf(t('blocked_by: [1, 2]')), /`blocked_by` must be a list of strings/);
  assert.equal(problemsOf(t('blocked_by: []')), '', 'an empty list is fine');
  assert.match(problemsOf('phases:\n  - id: one\n    tasks:\n      - id: a\n        covers: FR-01\n        scope: [src/**]'), /`covers` must be a list of strings/);
  assert.match(problemsOf('phases:\n  - id: one\n    tasks:\n      - id: a\n        covers: [FR-01]\n        scope: src/**'), /`scope` must be a list of strings/);
});

// ---------- Critical path ----------

const task = (id: string, blockedBy: string[] = [], complexity: Task['complexity'] = 'standard'): Task => ({ id, name: id, covers: [], blockedBy, scope: [], complexity, status: 'pending', fixRound: 0, risky: false });
const phase = (id: string, tasks: Task[], overlap = false): Phase => ({ id, name: id, status: 'pending', tasks, ...(overlap ? { overlap: true } : {}) });

test('the critical path does not depend on the order tasks are listed in', () => {
  const forward = criticalPath([phase('p', [task('producer', [], 'simple'), task('consumer', ['producer'], 'simple')])]);
  const reversed = criticalPath([phase('p', [task('consumer', ['producer'], 'simple'), task('producer', [], 'simple')])]);
  assert.deepEqual(reversed.tasks, ['producer', 'consumer']);
  assert.equal(reversed.weight, 2);
  assert.deepEqual(reversed, forward);
});

test('a reversed chain inside an overlap phase still follows only its blocked_by', () => {
  const c = criticalPath([
    phase('a', [task('base', [], 'complex')]),
    phase('b', [task('late', ['early'], 'simple'), task('early', ['base'], 'simple'), task('free', [], 'simple')], true),
  ]);
  assert.deepEqual(c.tasks, ['base', 'early', 'late']);
  assert.equal(c.weight, 3 + 1 + 1);
});

// ---------- Lock ownership ----------

const age = (p: string) => utimesSync(p, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));

test('a lock past the stale age is kept while its owner is still running', () => {
  const d = tmp();
  mkdirSync(join(d, '.lock'));
  writeFileSync(join(d, '.lock', 'owner'), `${process.pid} someone-else`);
  age(join(d, '.lock'));
  assert.throws(() => withLock(d, () => 'ran', 300), /state is locked/);
  assert.equal(readFileSync(join(d, '.lock', 'owner'), 'utf8'), `${process.pid} someone-else`);
});

test('a stale lock whose owner has exited is taken over', () => {
  const d = tmp();
  const dead = spawnSync('true').pid!;
  mkdirSync(join(d, '.lock'));
  writeFileSync(join(d, '.lock', 'owner'), `${dead} gone`);
  age(join(d, '.lock'));
  assert.equal(withLock(d, () => 'ran', 2000), 'ran');
  assert.ok(!existsSync(join(d, '.lock')), 'released after use');
});

test('a holder never removes a lock that is no longer its own', () => {
  const d = tmp();
  withLock(d, () => writeFileSync(join(d, '.lock', 'owner'), '1 another-token'));
  assert.equal(readFileSync(join(d, '.lock', 'owner'), 'utf8'), '1 another-token');
});

// ---------- Test runs ----------

function repo(): string {
  const d = tmp();
  const g = (...a: string[]) => execFileSync('git', a, { cwd: d, stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  return d;
}
const cfg = (test: string, extra: Partial<Config> = {}): Config => ({ test, maxParallel: 1, autoCommit: false, ...extra });

test('a green run records the commit it ran on', () => {
  const d = repo();
  const r = runTests(cfg('echo 1 passed'), d)!;
  assert.ok(r.ok);
  assert.equal(r.head, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: d, encoding: 'utf8' }).trim());
});

test('a run during which HEAD moves is not a pass and names no commit', () => {
  const d = repo();
  const r = runTests(cfg('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m moved'), d)!;
  assert.equal(r.ok, false);
  assert.equal(r.head, undefined);
  assert.match(r.tail, /checkout changed while the tests ran/);
});

test('a run past testTimeoutMinutes is stopped and reported as timed out', () => {
  const d = repo();
  const r = runTests(cfg('sleep 5', { testTimeoutMinutes: 0.005 }), d)!;
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
  assert.match(r.tail, /timed out after 0.005 min/);
});
