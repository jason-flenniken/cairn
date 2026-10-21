import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { runRepro } from '../src/commands/fix.ts';
import { run } from '../src/main.ts';
import { parsePlan } from '../src/plan-parse.ts';
import { renderStatus } from '../src/render.ts';
import { testSummary } from '../src/shared.ts';
import { newState } from '../src/state.ts';
import { pluginRoot, Refusal } from '../src/util.ts';
import { pd } from './plandir.ts';

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
process.env.GIT_AUTHOR_NAME = 't';
process.env.GIT_AUTHOR_EMAIL = 't@t';
process.env.GIT_COMMITTER_NAME = 't';
process.env.GIT_COMMITTER_EMAIL = 't@t';
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const write = (p: string, s: string) => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, s);
};
const ok = (cwd: string, ...argv: string[]) => run(argv, cwd);
const refused = (cwd: string, pattern: RegExp, ...argv: string[]) =>
  assert.throws(
    () => run(argv, cwd),
    (e: unknown) => {
      assert.ok(e instanceof Refusal, `expected a refusal, got ${e}`);
      assert.match(`${e.message}\n${e.fixes.join('\n')}`, pattern);
      return true;
    },
  );

const repos: string[] = [];
after(() => repos.forEach((r) => rmSync(r, { recursive: true, force: true })));

function mkRepo(config: Record<string, unknown> = { test: 'true', maxParallel: 3 }): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-polish-')));
  repos.push(repo);
  g(repo, 'init', '-q', '-b', 'main');
  write(join(repo, 'README.md'), 'hi\n');
  write(join(repo, '.sdlc/config.json'), JSON.stringify(config));
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
  return repo;
}

/** Act as the user through the mod: write the hash of a fresh secret and pass the secret in CAIRN_APPROVER. */
function asUser<T>(repo: string, fn: () => T): T {
  const secret = randomBytes(16).toString('hex');
  mkdirSync(join(repo, '.git/cairn'), { recursive: true });
  writeFileSync(join(repo, '.git/cairn/mod-secret.sha256'), createHash('sha256').update(secret).digest('hex'), { mode: 0o600 });
  process.env.CAIRN_APPROVER = secret;
  try {
    return fn();
  } finally {
    delete process.env.CAIRN_APPROVER;
  }
}

const PRD = `# PRD
## Problem
p
## Solution
s
## User stories
1. As a user I pay.
## Requirements
- FR-01 charge
- FR-02 refund
## Non-functional requirements
- NFR-01 fast
## Non-goals
- crypto
## Acceptance criteria
- FR-01 charges once
## Unhappy paths
- FR-01 double submit charges once
## Security considerations
- server-side amounts
## Open questions
- [x] which processor?
`;

const planWith = (tasks: string) => `## Goal
g
## Architecture
a
## Global constraints
c
## Review focus
r
## Phases
\`\`\`yaml cairn-tasks
phases:
  - id: core
    name: Core
    tasks:
${tasks}
\`\`\`
`;
const CHARGE = '      - { id: charge, name: Charge, covers: [FR-01], scope: ["src/charge/**"] }';
const REFUND = '      - { id: refund, name: Refund, covers: [FR-02], scope: ["src/refund/**"] }';
const PLAN = planWith(`${CHARGE}\n${REFUND}`);

/** A feature plan taken through discover, PRD, and plan approval to execute. */
function featureInExecute(repo: string, slug: string, plan = PLAN): { wt: string; dir: string } {
  const wt = ok(repo, 'new', slug, '--title', slug).data!.worktree as string;
  const dir = pd(wt, slug);
  ok(wt, 'decide', 'q', 'a');
  ok(wt, 'advance');
  write(join(dir, 'prd.md'), PRD);
  asUser(repo, () => ok(wt, 'approve', 'prd'));
  ok(wt, 'advance');
  write(join(dir, 'plan.md'), plan);
  ok(wt, 'plan', 'load');
  asUser(repo, () => ok(wt, 'approve', 'plan'));
  ok(wt, 'advance');
  return { wt, dir };
}

const stateOf = (dir: string) => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));

/** Start a task, commit files on its branch, and merge it into the plan branch. Returns the task worktree. */
function buildTask(wt: string, slug: string, id: string, files: Record<string, string>): string {
  const swt = ok(wt, 'task', 'start', id).data!.worktree as string;
  for (const [p, s] of Object.entries(files)) write(join(swt, p), s);
  g(swt, 'add', '-A');
  g(swt, 'commit', '-q', '-m', id);
  g(wt, 'merge', '-q', '--no-ff', '-m', `merge ${id}`, `task/${slug}/${id}`);
  return swt;
}

// FR-36

test('testSummary picks the last pass/fail count line, not a trailing npm notice', () => {
  const out = ['ℹ tests 12', 'ℹ pass 12', 'ℹ fail 0', 'npm notice New major version available', 'npm notice Run npm i -g npm'];
  assert.equal(testSummary(out), 'ℹ fail 0');
  assert.equal(testSummary(['ℹ pass 12', 'npm notice New version']), 'ℹ pass 12');
  assert.equal(testSummary(['Tests: 14 passed, 0 failed', 'done']), 'Tests: 14 passed, 0 failed');
});

test('testSummary falls back to the last line when no line has counts', () => {
  assert.equal(testSummary(['building', 'all good']), 'all good');
  assert.equal(testSummary([]), undefined);
});

test('task done records the pass line when the test output ends with an npm notice', () => {
  const repo = mkRepo({ test: "printf 'ℹ pass 12\\nnpm notice New version available\\n'", maxParallel: 3 });
  const { wt, dir } = featureInExecute(repo, 'summary');
  buildTask(wt, 'summary', 'charge', { 'src/charge/a.ts': '1\n' });
  ok(wt, 'task', 'done', 'charge');
  assert.match(stateOf(dir).phases[0].tasks[0].tests, /→ ℹ pass 12$/);
});

// FR-37

test('STATUS.md names who approved: the menu, the terminal', () => {
  const s = newState('x', 'X', 'feature', 'sdlc/x', 'main');
  s.approvals.prd = { at: '2026-10-21T10:00:00Z', via: 'human', source: 'mod' };
  s.approvals.plan = { at: '2026-10-21T10:00:00Z', via: 'human', source: 'terminal' };
  s.approvals.ship = { at: '2026-10-21T10:00:00Z', via: 'human', source: 'mod' };
  const md = renderStatus(s);
  assert.match(md, /PRD approved 2026-10-21 \(you, in the menu\)/);
  assert.match(md, /Plan approved 2026-10-21 \(you, in the terminal\)/);
  assert.match(md, /Ship approved 2026-10-21 \(you, in the menu\)/);
});

test('STATUS.md shows the source of each override', () => {
  const s = newState('x', 'X', 'feature', 'sdlc/x', 'main');
  s.log.push({ at: '2026-10-21T10:00:00Z', event: 'override: advance', detail: 'no decisions (source: mod)', override: 'skip the interview' });
  s.log.push({ at: '2026-10-21T11:00:00Z', event: 'override: task done', detail: 'tests are not green (source: terminal)', override: 'flaky' });
  const md = renderStatus(s);
  assert.match(md, /advance: skip the interview \(you, in the menu\)/);
  assert.match(md, /task done: flaky \(you, in the terminal\)/);
});

test('an approval made through the mod shows in the generated STATUS.md', () => {
  const repo = mkRepo();
  const { dir } = featureInExecute(repo, 'sources');
  assert.match(readFileSync(join(dir, 'STATUS.md'), 'utf8'), /PRD approved \d{4}-\d\d-\d\d \(you, in the menu\)/);
});

// FR-39

test('plan load refuses a requirement id that is not FR-<digits> and names it', () => {
  const repo = mkRepo();
  const wt = ok(repo, 'new', 'strict', '--title', 'Strict').data!.worktree as string;
  const dir = pd(wt, 'strict');
  ok(wt, 'decide', 'q', 'a');
  ok(wt, 'advance');
  write(join(dir, 'prd.md'), PRD.replace('- FR-02 refund', '- **FR-02a** refund'));
  asUser(repo, () => ok(wt, 'approve', 'prd'));
  ok(wt, 'advance');
  write(join(dir, 'plan.md'), PLAN);
  refused(wt, /FR-02a[\s\S]*FR-<digits>/, 'plan', 'load');
});

test('well-formed bold ids and bold words in the PRD do not trip the id check', () => {
  const prd = PRD.replace('- FR-01 charge', '- **FR-01** charge\n- **Friendly** wording').replace('- FR-02 refund', '- **FR-02 Refund.** refund');
  assert.deepEqual(parsePlan(PLAN, prd).problems, []);
});

// FR-40

test('a prefactor task may have empty covers but still needs scope', () => {
  const pre = (extra: string) => `      - { id: groundwork, name: Groundwork, kind: prefactor, covers: []${extra} }`;
  const withScope = planWith(`${pre(', scope: ["src/shared/**"]')}\n${CHARGE}\n${REFUND}`);
  assert.deepEqual(parsePlan(withScope, PRD).problems, []);
  const noScope = planWith(`${pre('')}\n${CHARGE}\n${REFUND}`);
  assert.match(parsePlan(noScope, PRD).problems.join('\n'), /groundwork.*scope/);
});

test('empty covers without kind: prefactor still refuses', () => {
  const plan = planWith(`      - { id: groundwork, name: Groundwork, covers: [], scope: ["src/shared/**"] }\n${CHARGE}\n${REFUND}`);
  assert.match(parsePlan(plan, PRD).problems.join('\n'), /groundwork.*covers/);
});

test('an unknown task kind is a problem', () => {
  const plan = planWith(`      - { id: odd, name: Odd, kind: chore, covers: [], scope: ["src/**"] }\n${CHARGE}\n${REFUND}`);
  assert.match(parsePlan(plan, PRD).problems.join('\n'), /odd.*kind/);
});

// FR-42

test('a task started before a re-plan can be marked done after it, with no override', () => {
  const repo = mkRepo();
  const { wt, dir } = featureInExecute(repo, 'replan');
  const swt = ok(wt, 'task', 'start', 'charge').data!.worktree as string;
  const before = stateOf(dir).phases[0].tasks[0].base;
  assert.ok(before, 'the task recorded its base');
  write(join(dir, 'plan.md'), planWith(`${CHARGE}\n${REFUND}\n      - { id: audit, name: Audit, covers: [], kind: prefactor, scope: ["src/audit/**"] }`));
  ok(wt, 'plan', 'load', '--replan');
  assert.equal(stateOf(dir).phases[0].tasks[0].base, before, 're-plan keeps the base');
  asUser(repo, () => ok(wt, 'approve', 'plan'));
  ok(wt, 'advance');
  write(join(swt, 'src/charge/a.ts'), '1\n');
  g(swt, 'add', '-A');
  g(swt, 'commit', '-q', '-m', 'charge');
  g(wt, 'merge', '-q', '--no-ff', '-m', 'merge charge', 'task/replan/charge');
  ok(wt, 'task', 'done', 'charge');
  const s = stateOf(dir);
  assert.equal(s.phases[0].tasks[0].status, 'done');
  assert.ok(!s.log.some((l: { override?: string }) => l.override), 'no override was used');
});

// FR-41

test('task done logs each file changed outside the task scope as drift, and phase finish lists it without a review step', () => {
  const repo = mkRepo();
  const { wt, dir } = featureInExecute(repo, 'driftcheck');
  buildTask(wt, 'driftcheck', 'charge', { 'src/charge/a.ts': '1\n', 'README.md': 'changed through bash\n' });
  ok(wt, 'task', 'done', 'charge');
  const s = stateOf(dir);
  assert.deepEqual(s.drift.map((d: { path: string }) => d.path), ['README.md']);
  assert.equal(s.drift[0].task, 'charge');
  assert.match(s.drift[0].reason, /outside task "Charge" scope/);
  buildTask(wt, 'driftcheck', 'refund', { 'src/refund/b.ts': '2\n' });
  ok(wt, 'task', 'done', 'refund');
  assert.equal(stateOf(dir).drift.length, 1, 'a task inside its scope adds no drift');
  assert.match(ok(wt, 'phase', 'finish').message, /out-of-scope edit\(s\): README\.md/);
});

test('task done does not add drift for a path already logged and unreviewed', () => {
  const repo = mkRepo();
  const { wt, dir } = featureInExecute(repo, 'nodup');
  const swt = ok(wt, 'task', 'start', 'charge').data!.worktree as string;
  write(join(swt, 'README.md'), 'x\n');
  write(join(swt, 'src/charge/a.ts'), '1\n');
  g(swt, 'add', '-A');
  g(swt, 'commit', '-q', '-m', 'charge');
  const st = stateOf(dir);
  st.drift.push({ path: 'README.md', at: '2026-10-21T00:00:00Z', reason: 'edited outside task "Charge" scope', task: 'charge' });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(st));
  g(wt, 'merge', '-q', '--no-ff', '-m', 'merge', 'task/nodup/charge');
  ok(wt, 'task', 'done', 'charge');
  assert.equal(stateOf(dir).drift.length, 1);
});

// FR-28

test('a re-plan of an escalated fix plan refuses to drop the fix task', () => {
  const repo = mkRepo();
  const wt = ok(repo, 'new', 'bugfix', '--track', 'fix', '--title', 'Bug').data!.worktree as string;
  const dir = pd(wt, 'bugfix');
  write(join(wt, 'bug.txt'), 'broken\n');
  g(wt, 'add', '-A');
  g(wt, 'commit', '-q', '-m', 'bug');
  ok(wt, 'repro', 'grep -q fixed bug.txt');
  ok(wt, 'advance');
  ok(wt, 'escalate');
  assert.equal(stateOf(dir).phases[0].tasks[0].id, 'fix');
  write(join(dir, 'prd.md'), PRD);
  asUser(repo, () => ok(wt, 'approve', 'prd'));
  ok(wt, 'advance');
  write(join(dir, 'plan.md'), PLAN);
  refused(wt, /"fix" task[\s\S]*plan\.md/, 'plan', 'load', '--replan');
  // keeping the fix task loads
  write(join(dir, 'plan.md'), planWith(`      - { id: fix, name: Fix, covers: [FR-01, FR-02], scope: ["bug.txt"] }`));
  ok(wt, 'plan', 'load', '--replan');
});

// FR-35

test('cairn new gives the path and cd command, with no EnterWorktree', () => {
  const repo = mkRepo();
  const r = ok(repo, 'new', 'hint', '--title', 'Hint');
  const wt = r.data!.worktree as string;
  assert.ok(!r.message.includes('EnterWorktree'));
  assert.ok(r.message.includes(`Worktree: ${wt}`));
  assert.ok(r.message.includes('/cairn:next'));
  assert.ok(!r.message.includes('claude`'));
});

test('the terminal approval hint is a runnable command: cd to the plan worktree, then the absolute bin/cairn', () => {
  const repo = mkRepo();
  const wt = ok(repo, 'new', 'hint2', '--title', 'Hint2').data!.worktree as string;
  assert.throws(
    () => run(['approve', 'prd'], wt),
    (e: unknown) => e instanceof Refusal && e.fixes.some(f => f.includes(`cd ${wt} && ${pluginRoot()}/bin/cairn approve prd --human`)),
  );
});

// repro wrapper under the Bash sandbox

test('the shell setpgid error never reaches the recorded repro tail', () => {
  const repo = mkRepo();
  const leak = "echo 'sh: child setpgid (4242 to 4242): Operation not permitted' >&2; echo 'assertion failed: expected fixed' >&2; exit 1";
  const r = runRepro(leak, repo, { maxParallel: 1, autoCommit: false });
  assert.equal(r.outcome, 'fails');
  assert.equal(r.detail, 'assertion failed: expected fixed');
  const only = runRepro("echo 'sh: child setpgid (1 to 1): Operation not permitted' >&2; exit 1", repo, { maxParallel: 1, autoCommit: false });
  assert.equal(only.detail, 'exit 1');
});
