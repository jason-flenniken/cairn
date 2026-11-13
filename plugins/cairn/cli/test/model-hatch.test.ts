import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { builderLine, builderOf } from '../src/builder.ts';
import { builderLines } from '../src/commands/publish.ts';
import { run } from '../src/main.ts';
import { parsePlan } from '../src/plan-parse.ts';
import type { State, Task } from '../src/types.ts';
import { Refusal } from '../src/util.ts';
import { pd } from './plandir.ts';

const root = join(import.meta.dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const PRD = `# PRD
## Problem
p
## Solution
s
## Requirements
- **FR-01** a. Check: a
- **FR-02** b. Check: b
- **FR-03** c. Check: c
- **FR-04** d. Check: d
## Non-goals
- none
## Open questions
- [x] q
`;
const plan = (tasks: string) => `## Goal
g
## Architecture
a
## Global constraints
- none
## Phases
\`\`\`yaml cairn-tasks
phases:
  - id: core
    name: Core
    tasks:
${tasks}
\`\`\`
`;
const TASKS = `      - { id: s, name: Small, covers: [FR-01], scope: ["src/s/**"], complexity: simple }
      - { id: m, name: Medium, covers: [FR-02], scope: ["src/m/**"] }
      - { id: c, name: Complex, covers: [FR-03], scope: ["src/c/**"], complexity: complex }
      - { id: k, name: Careful, covers: [FR-04], scope: ["src/k/**"], model: opus, model_reason: "undoable data migration" }`;

test('plan parse: a model mark with a reason loads; without one, or unknown, it refuses', () => {
  const ok = parsePlan(plan(TASKS), PRD);
  assert.deepEqual(ok.problems, []);
  const k = ok.phases[0].tasks[3];
  assert.equal(k.model, 'opus');
  assert.equal(k.modelReason, 'undoable data migration');
  assert.equal(ok.phases[0].tasks[0].model, undefined);
  const noWhy = parsePlan(plan(TASKS.replace(', model_reason: "undoable data migration"', '')), PRD);
  assert.match(noWhy.problems.join(), /task "k" asks for opus without saying why: add model_reason/);
  const unknown = parsePlan(plan(TASKS.replace('model: opus', 'model: gpt')), PRD);
  assert.match(unknown.problems.join(), /task "k": model must be haiku, sonnet, opus/);
});

test('builderOf: complexity, plan mark, MVP and the last fix attempt', () => {
  const std = { level: 'standard' } as State;
  const mvp = { level: 'mvp' } as State;
  const t = (complexity: Task['complexity'], extra: Partial<Task> = {}) => ({ complexity, ...extra });
  assert.deepEqual(builderOf(std, t('simple')), { model: 'haiku' });
  assert.deepEqual(builderOf(std, t('standard')), { model: 'sonnet' });
  assert.deepEqual(builderOf(std, t('complex')), { model: 'sonnet', effort: 'high' });
  assert.deepEqual(builderOf(std, t('complex', { model: 'opus', modelReason: 'why' })), { model: 'opus', reason: 'why' });
  assert.deepEqual(builderOf(mvp, t('standard')), { model: 'haiku' });
  assert.deepEqual(builderOf(mvp, t('complex')), { model: 'sonnet' });
  assert.equal(builderOf(mvp, t('simple', { model: 'opus', modelReason: 'why' })).model, 'opus');
  assert.equal(builderOf(std, t('complex'), 1).model, 'sonnet');
  assert.equal(builderOf(std, t('complex'), 2).model, 'opus');
  assert.equal(builderOf(std, t('complex'), 2).effort, undefined);
  assert.equal(builderOf(std, t('simple'), 2).model, 'sonnet');
  assert.equal(builderOf(std, t('standard', { model: 'opus', modelReason: 'why' }), 2).model, 'opus');
  assert.equal(builderLine({ model: 'sonnet', effort: 'high' }), 'Builder: sonnet, effort high');
  assert.equal(builderLine({ model: 'opus', reason: 'why' }), 'Builder: opus — why');
});

test('publish: a ticket whose task is marked carries the Builder line', () => {
  const t = (name: string, extra: Partial<Task> = {}) => ({ name, ...extra }) as Task;
  assert.equal(builderLines([t('a')]), '');
  assert.equal(builderLines([t('a'), t('b', { model: 'opus', modelReason: 'locking' })]), '\n\nBuilder: opus — locking');
});

const roots: string[] = [];
before(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
});
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function world(level?: string) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-hatch-')));
  roots.push(repo);
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  mkdirSync(join(repo, '.cairn'));
  writeFileSync(join(repo, '.cairn/config.json'), JSON.stringify({ test: 'true', maxParallel: 4 }));
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
  const user = <T>(fn: () => T): T => {
    const secret = randomBytes(16).toString('hex');
    mkdirSync(join(repo, '.git/cairn'), { recursive: true });
    writeFileSync(join(repo, '.git/cairn/mod-secret.sha256'), createHash('sha256').update(secret).digest('hex'), { mode: 0o600 });
    process.env.CAIRN_APPROVER = secret;
    try {
      return fn();
    } finally {
      delete process.env.CAIRN_APPROVER;
    }
  };
  const wt = run(['new', 'billing', '--title', 'Billing', ...(level ? ['--level', level] : [])], repo).data!.worktree as string;
  const dir = pd(wt, 'billing');
  run(['decide', 'Which?', 'This', '--why', 'because'], wt);
  run(['advance'], wt);
  writeFileSync(join(dir, 'prd.md'), PRD);
  user(() => run(['approve', 'prd'], wt));
  run(['advance'], wt);
  writeFileSync(join(dir, 'plan.md'), plan(TASKS));
  const load = run(['plan', 'load'], wt);
  user(() => run(['approve', 'plan'], wt));
  run(['advance'], wt);
  return { wt, load };
}

test('plan load lists the Opus builds, and task start prints the Builder line for each kind of task', () => {
  const w = world();
  assert.match(w.load.message, /\nOpus builds: Careful \(undoable data migration\)\./);
  const line = (id: string) => run(['task', 'start', id], w.wt).message.split('\n').pop();
  assert.equal(line('s'), 'Builder: haiku');
  assert.equal(line('m'), 'Builder: sonnet');
  assert.equal(line('c'), 'Builder: sonnet, effort high');
  const k = run(['task', 'start', 'k'], w.wt);
  assert.equal(k.message.split('\n').pop(), 'Builder: opus — undoable data migration');
  assert.deepEqual(k.data!.builder, { model: 'opus', reason: 'undoable data migration' });
  const ready = run(['ready'], w.wt);
  assert.equal(ready.data!.phase, 'core');
});

test('the fix brief names the builder: same model on the first attempt, one tier up on the last', () => {
  const w = world();
  run(['task', 'start', 'c'], w.wt);
  run(['task', 'step', 'c', 'fixing'], w.wt);
  assert.equal(run(['task', 'brief', 'c', '--role', 'fix'], w.wt).message.split('\n').pop(), 'Builder: sonnet, effort high');
  run(['task', 'step', 'c', 'fixing'], w.wt);
  const last = run(['task', 'brief', 'c', '--role', 'fix'], w.wt);
  assert.equal(last.message.split('\n').pop(), 'Builder: opus — the last fix attempt goes one tier up');
  assert.equal((last.data!.builder as { model: string }).model, 'opus');
  const review = run(['task', 'brief', 'c', '--role', 'review'], w.wt);
  assert.equal(review.data!.builder, undefined);
});

test('at MVP the builder is one tier lower, and a plan mark still wins', () => {
  const w = world('mvp');
  const line = (id: string) => run(['task', 'start', id], w.wt).message.split('\n').pop();
  assert.equal(line('m'), 'Builder: haiku');
  assert.equal(line('c'), 'Builder: sonnet');
  assert.equal(line('k'), 'Builder: opus — undoable data migration');
});

test('plan load refuses a model mark with no reason', () => {
  assert.throws(() => {
    const p = parsePlan(plan(TASKS.replace(', model_reason: "undoable data migration"', '')), PRD);
    if (p.problems.length) throw new Refusal(p.problems.join());
  }, /without saying why/);
});

test('docs: tiers table, effort lines, and the Hard parts wording', () => {
  const tiers = read('references/model-tiers.md');
  assert.match(tiers, /\| complex \| sonnet \| high \|/);
  assert.match(tiers, /Opus builds a task only when the plan marks it/);
  assert.match(tiers, /Pass `effort` on an `Agent` call only when the `Builder:` line names one/);
  for (const [a, e] of [['task-reviewer', 'high'], ['security-reviewer', 'high'], ['branch-reviewer', 'high'], ['linear-sender', 'low'], ['recorder', 'low']])
    assert.match(read(`agents/${a}.md`), new RegExp(`^effort: ${e}$`, 'm'), a);
  for (const f of readdirSync(join(root, 'agents'))) {
    const fm = read(`agents/${f}`).split('---')[1];
    if (!/^(task-reviewer|security-reviewer|branch-reviewer|linear-sender|recorder)\.md$/.test(f)) assert.doesNotMatch(fm, /^effort:/m, f);
  }
  assert.match(read('agents/researcher.md'), /"Hard parts"/);
  assert.match(read('agents/prd-writer.md'), /## Hard parts/);
  assert.match(read('agents/prd-writer.md'), /Builder: opus — <reason>/);
  assert.match(read('templates/prd.md'), /## Hard parts/);
  assert.match(read('agents/plan-writer.md'), /model: opus` with `model_reason/);
  assert.match(read('agents/plan-writer.md'), /a handful per plan at most/);
  assert.match(read('agents/plan-reviewer.md'), /model: opus/);
  assert.match(read('agents/plan-reviewer.md'), /Hard parts but has no mark/);
  assert.match(read('templates/plan.md'), /# model_reason:/);
  assert.match(read('procedures/plan.md'), /Opus builds:/);
  assert.match(read('procedures/execute.md'), /`Builder:` line/);
  assert.doesNotMatch(read('procedures/execute.md'), /complex: opus/);
  assert.match(read('references/cli.md'), /model_reason/);
});
