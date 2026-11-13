import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { run } from '../src/main.ts';
import { parsePlan } from '../src/plan-parse.ts';
import { chainText, criticalPath, readySet } from '../src/ready.ts';
import type { Complexity, Phase, State, Task } from '../src/types.ts';
import { pd } from './plandir.ts';

// ---------- Pure rules ----------

const task = (id: string, blockedBy: string[] = [], extra: Partial<Task> = {}): Task => ({ id, name: id, covers: [], blockedBy, scope: [`src/${id}/**`], complexity: 'standard', status: 'pending', fixRound: 0, risky: false, ...extra });
const phase = (id: string, tasks: Task[], extra: Partial<Phase> = {}): Phase => ({ id, name: id, status: 'pending', tasks, ...extra });
const withStatus = (phases: Phase[]): Phase[] => {
  for (const p of phases) p.status = p.tasks.every((t) => t.status === 'done') ? 'done' : p.tasks.some((t) => t.status !== 'pending') ? 'in_progress' : 'pending';
  return phases;
};
const stateOf = (phases: Phase[]): State => ({ stage: 'execute', phases: withStatus(phases) }) as unknown as State;

/** The Savvyling-shaped plan: 11 tasks in three phases. */
const savvyling = (overlap = false): Phase[] => [
  phase('one', [task('move-app'), task('workspace-stubs', ['move-app']), task('root-tooling', ['workspace-stubs']), task('shared-deno-bridge', ['root-tooling'])]),
  phase('two', [task('ci-and-db-tests', ['root-tooling']), task('config-module', ['shared-deno-bridge']), task('vercel-deploy', ['config-module']), task('docs-and-decisions', ['config-module', 'vercel-deploy']), task('bookkeeping', ['root-tooling'])], { overlap }),
  phase('three', [task('telemetry-core', ['config-module']), task('telemetry-wiring', ['telemetry-core'])], { overlap }),
];

test('criticalPath: a serial plan without overlap runs through every phase', () => {
  const c = criticalPath(savvyling());
  assert.equal(c.total, 11);
  assert.equal(c.count, 9, 'each phase waits for the whole earlier one');
  assert.deepEqual(c.tasks.slice(0, 4), ['move-app', 'workspace-stubs', 'root-tooling', 'shared-deno-bridge']);
  assert.equal(c.tasks.at(-1), 'telemetry-wiring');
  assert.equal(c.weight, 18);
  assert.equal(c.totalWeight, 22);
});

test('criticalPath: overlap phases keep only their blocked_by, and the chain reads move-app → … → docs', () => {
  const c = criticalPath(savvyling(true));
  assert.equal(c.count, 7);
  assert.equal(c.total, 11);
  assert.deepEqual(c.tasks, ['move-app', 'workspace-stubs', 'root-tooling', 'shared-deno-bridge', 'config-module', 'vercel-deploy', 'docs-and-decisions']);
  assert.equal(chainText(c.tasks), 'move-app → … → vercel-deploy → docs-and-decisions');
  assert.equal(chainText(['a', 'b', 'c', 'd']), 'a → b → c → d', 'a short chain shows in full');
});

test('criticalPath: complexity weights the chain', () => {
  const c = criticalPath([phase('p', [task('a'), task('b', [], { complexity: 'complex' as Complexity }), task('c', ['a'], { complexity: 'simple' as Complexity })])]);
  assert.deepEqual([c.tasks, c.weight], [['b'], 3], 'one complex task outweighs a standard then simple pair? 2+1 ties 3, the earlier end wins');
  assert.deepEqual(criticalPath([]).tasks, []);
});

test('overlap: parses, and is refused on the first phase or as a non-boolean', () => {
  const prd = '## Requirements\n- **FR-01** a. Check: x\n';
  const plan = (first: string, second: string) => `## Goal\ng\n## Architecture\na\n## Phases\n\`\`\`yaml cairn-tasks\nphases:\n  - id: one\n    name: One\n${first}    tasks:\n      - { id: a, name: A, covers: [FR-01], scope: ["src/a/**"] }\n  - id: two\n    name: Two\n${second}    tasks:\n      - { id: b, name: B, covers: [], kind: prefactor, scope: ["src/b/**"], blocked_by: [a] }\n\`\`\`\n`;
  const ok = parsePlan(plan('', '    overlap: true\n'), prd);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.phases.map((p) => p.overlap), [undefined, true]);
  assert.ok(parsePlan(plan('    overlap: true\n', ''), prd).problems.some((x) => /first phase/.test(x)));
  assert.ok(parsePlan(plan('', '    overlap: yes please\n'), prd).problems.some((x) => /overlap must be true or false/.test(x)));
});

test('readySet: an overlap phase starts a task early; a plain phase does not', () => {
  const build = (overlap: boolean) => {
    const a = task('a', [], { status: 'in_progress', substep: 'implementing' });
    return stateOf([phase('one', [a, task('x')]), phase('two', [task('free'), task('needs-a', ['a']), task('needs-x', ['x'])], { overlap })]);
  };
  const plain = readySet(build(false), 5);
  assert.deepEqual(plain.ready.map((t) => t.id), ['x']);
  const over = readySet(build(true), 5);
  assert.deepEqual(over.ready.map((t) => t.id).sort(), ['free', 'x']);
  assert.deepEqual(over.waiting.map((w) => [w.task.id, w.on]).sort(), [['needs-a', ['a']], ['needs-x', ['x']]], 'a blocker still holds a task back');
  // Once its blocker is done, the overlap task is ready while the earlier phase is still open.
  const s = build(true);
  s.phases[0].tasks[0].status = 'done';
  assert.deepEqual(readySet(s, 5).ready.map((t) => t.id).sort(), ['free', 'needs-a', 'x']);
  // A third phase follows only when it is an overlap phase too.
  const three = stateOf([phase('one', [task('a')]), phase('two', [task('b')], { overlap: true }), phase('three', [task('c')])]);
  assert.deepEqual(readySet(three, 5).ready.map((t) => t.id), ['a', 'b']);
  three.phases[2].overlap = true;
  assert.deepEqual(readySet(three, 5).ready.map((t) => t.id), ['a', 'b', 'c']);
});

test('readySet: reviewing and merging tasks free a builder slot; implementing, fixing and blocked do not', () => {
  const state = (substep?: Task['substep']) => stateOf([phase('p', [task('busy', [], { status: 'in_progress', substep }), task('next')])]);
  assert.deepEqual(readySet(state('implementing'), 1).ready, []);
  assert.deepEqual(readySet(state('fixing'), 1).ready, []);
  assert.deepEqual(readySet(state('blocked'), 1).ready, [], 'a blocked task still holds its builder');
  assert.deepEqual(readySet(state(undefined), 1).ready, []);
  assert.deepEqual(readySet(state('reviewing'), 1).ready.map((t) => t.id), ['next']);
  assert.deepEqual(readySet(state('merging'), 1).ready.map((t) => t.id), ['next']);
  assert.deepEqual(readySet(state('implementing'), 1).waiting.map((w) => w.on), [['parallel cap']]);
  // A review still holds its files: the scope check keeps counting it.
  const clash = stateOf([phase('p', [task('busy', [], { status: 'in_progress', substep: 'reviewing', scope: ['src/shared/**'] }), task('next', [], { scope: ['src/shared/**'] })])]);
  assert.deepEqual(readySet(clash, 3).waiting.map((w) => w.on), [['scope overlap with running work']]);
});

// ---------- In a repo ----------

let repo: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const write = (p: string, s: string) => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, s);
};
const ok = (cwd: string, ...argv: string[]) => run(argv, cwd);

const PRD = '## Problem\np\n## Solution\ns\n## Requirements\n- **FR-01** a. Check: x\n- **FR-02** b. Check: y\n## Non-goals\n- none\n## Open questions\n- [x] none\n';
const planMd = (scope: string) => `## Goal\ng\n## Architecture\na\n## Phases\n\`\`\`yaml cairn-tasks\nphases:\n  - id: one\n    name: One\n    tasks:\n      - { id: first, name: First, covers: [FR-01], scope: ["${scope}"] }\n      - { id: second, name: Second, covers: [FR-02], scope: ["src/second/**"], blocked_by: [first] }\n\`\`\`\n`;

/** A plan worktree moved straight to a stage; the CLI is the only writer of state in real use, tests may jump. */
function newPlan(slug: string, stage: State['stage'], scope: string): { wt: string; dir: string } {
  const wt = ok(repo, 'new', slug, '--title', slug).data!.worktree as string;
  const dir = pd(wt, slug);
  write(join(dir, 'prd.md'), PRD);
  write(join(dir, 'plan.md'), planMd(scope));
  const file = join(dir, 'state.json');
  const s = JSON.parse(readFileSync(file, 'utf8'));
  const parsed = parsePlan(planMd(scope), PRD);
  assert.deepEqual(parsed.problems, []);
  Object.assign(s, { stage, phases: parsed.phases });
  if (stage === 'execute') s.phases[0].status = 'in_progress';
  writeFileSync(file, JSON.stringify(s, null, 2));
  return { wt, dir };
}

before(() => {
  process.env.GIT_AUTHOR_NAME = 't';
  process.env.GIT_AUTHOR_EMAIL = 't@t';
  process.env.GIT_COMMITTER_NAME = 't';
  process.env.GIT_COMMITTER_EMAIL = 't@t';
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-wider-')));
  g(repo, 'init', '-q', '-b', 'main');
  write(join(repo, 'README.md'), 'hi\n');
  write(join(repo, '.gitignore'), '.setup-ran\n');
  // Setup fails when a plan's state lock is held, so a pass shows it ran after the lock was released.
  write(join(repo, '.cairn/config.json'), JSON.stringify({ setup: 'if ls -d ../*/docs/cairn/plans/*/.lock >/dev/null 2>&1; then echo locked >&2; exit 1; fi; touch .setup-ran', maxParallel: 3 }));
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

test('plan load reports the longest chain and warns about a file another plan also builds', () => {
  const a = newPlan('sav-17-db', 'execute', 'src/config/**');
  const b = newPlan('billing', 'plan', 'src/config/**');
  const loaded = ok(b.wt, 'plan', 'load');
  assert.match(loaded.message, /Longest chain: 2 of 2 tasks \(first → second\); at most 3 at once\./);
  const chain = loaded.data!.chain as { tasks: string[]; weight: number; count: number; total: number };
  assert.deepEqual([chain.tasks, chain.weight, chain.count, chain.total], [['first', 'second'], 4, 2, 2]);
  assert.match(loaded.message, /src\/config\/\*\* is also in plan sav-17-db \(execute\): expect a merge conflict; order them or split the file/);
  assert.deepEqual(loaded.data!.warnings, ['src/config/** is also in plan sav-17-db (execute): expect a merge conflict; order them or split the file']);
  // The other plan sees it too, in its status warnings, and the same plan never warns about itself.
  const warnings = ok(a.wt, 'status').data!.warnings as string[];
  assert.ok(warnings.some((w) => /is also in plan billing \(plan\)/.test(w)), warnings.join(' | '));
  assert.ok(!warnings.some((w) => /sav-17-db/.test(w)));
  // Finished tasks and closed plans no longer count; a disjoint scope never warned.
  writeFileSync(join(a.dir, 'plan.md'), planMd('src/other/**').replace('src/second/**', 'src/other-second/**'));
  ok(a.wt, 'plan', 'load', '--replan');
  assert.deepEqual(ok(b.wt, 'plan', 'load').data!.warnings, []);
});

test('task start runs setup after the lock is released and still reports it', () => {
  const { wt } = newPlan('setup-check', 'execute', 'src/setup/**');
  const started = ok(wt, 'task', 'start', 'first');
  const path = started.data!.worktree as string;
  assert.ok(existsSync(join(path, '.setup-ran')), 'setup ran in the task worktree');
  assert.match(started.message, /Started task "First" in .* \(branch task\/setup-check\/first\)\.\nSetup ran: /, started.message);
  assert.doesNotMatch(started.message, /Setup failed/);
  // The task is recorded as started; resuming does not run setup again.
  const again = ok(wt, 'task', 'start', 'first');
  assert.match(again.message, /already running/);
  assert.doesNotMatch(again.message, /Setup/);
});

test('an overlap task starts while the earlier phase is open, and its phase finishes after', () => {
  const wt = ok(repo, 'new', 'overlapper', '--title', 'overlapper').data!.worktree as string;
  const dir = pd(wt, 'overlapper');
  const plan = `## Goal\ng\n## Architecture\na\n## Phases\n\`\`\`yaml cairn-tasks\nphases:\n  - id: one\n    name: One\n    tasks:\n      - { id: first, name: First, covers: [FR-01], scope: ["src/o-first/**"] }\n      - { id: slow, name: Slow, covers: [FR-01], scope: ["src/o-slow/**"] }\n  - id: two\n    name: Two\n    overlap: true\n    tasks:\n      - { id: early, name: Early, covers: [FR-02], scope: ["src/o-early/**"], blocked_by: [first] }\n      - { id: late, name: Late, covers: [FR-02], scope: ["src/o-late/**"], blocked_by: [slow] }\n\`\`\`\n`;
  write(join(dir, 'prd.md'), PRD);
  const parsed = parsePlan(plan, PRD);
  assert.deepEqual(parsed.problems, []);
  const file = join(dir, 'state.json');
  const s = JSON.parse(readFileSync(file, 'utf8'));
  Object.assign(s, { stage: 'execute', phases: parsed.phases });
  s.phases[0].status = 'in_progress';
  // "first" is done; "slow" still runs.
  Object.assign(s.phases[0].tasks[0], { status: 'done' });
  writeFileSync(file, JSON.stringify(s, null, 2));
  const ready = ok(wt, 'ready');
  assert.deepEqual((ready.data!.ready as { id: string }[]).map((x) => x.id), ['slow', 'early']);
  assert.deepEqual(ready.data!.waiting, [{ id: 'late', on: ['slow'] }]);
  const started = ok(wt, 'task', 'start', 'early');
  assert.match(started.message, /Started task "Early"/);
  const after = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(after.phases[1].status, 'in_progress', 'the later phase is under way');
  assert.equal(after.phases[0].status, 'in_progress');
  assert.throws(() => ok(wt, 'task', 'start', 'late'), /waiting on slow/);
});

test('criticalPath: a phase that is not overlap follows every phase back to the last non-overlap one', () => {
  const c = criticalPath([
    phase('p0', [task('a'), task('b', ['a']), task('c', ['b'])].map((t) => ({ ...t, complexity: 'complex' as Complexity }))),
    phase('p1', [task('o', [], { complexity: 'simple' })], { overlap: true }),
    phase('p2', [task('z', [], { complexity: 'simple' })]),
  ]);
  assert.deepEqual(c.tasks, ['a', 'b', 'c', 'z']);
});
