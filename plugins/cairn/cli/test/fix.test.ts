import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { run } from '../src/main.ts';
import { Refusal } from '../src/util.ts';
import { setPullRequest } from './handsoff-helpers.ts';
import { pd } from './plandir.ts';

let repo: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
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
/** Act as the user through the mod: write the hash of a fresh mod secret and pass the secret in CAIRN_APPROVER. */
function asUser<T>(fn: () => T): T {
  const secret = randomBytes(16).toString('hex');
  mkdirSync(join(repo, '.git/cairn'), { recursive: true });
  writeFileSync(join(repo, '.git/cairn', `approver-${createHash('sha256').update(secret).digest('hex')}`), '1', { mode: 0o600 });
  process.env.CAIRN_APPROVER = secret;
  try {
    return fn();
  } finally {
    delete process.env.CAIRN_APPROVER;
  }
}
const byUser = (cwd: string, ...argv: string[]) => asUser(() => ok(cwd, ...argv));
const refusedByUser = (cwd: string, pattern: RegExp, ...argv: string[]) => asUser(() => refused(cwd, pattern, ...argv));

const dirOf = (wt: string, slug: string) => pd(wt, slug);
const stateOf = (wt: string, slug: string) => JSON.parse(readFileSync(join(dirOf(wt, slug), 'state.json'), 'utf8'));
const commitAll = (cwd: string, msg: string) => {
  g(cwd, 'add', '-A');
  g(cwd, 'commit', '-q', '-m', msg);
};

/** The bug: bug.txt says "broken". The repro fails until it says "fixed". */
const REPRO = 'grep -q fixed bug.txt';

/** A fix plan at stage repro with its own worktree. */
function newFix(slug: string): string {
  const wt = ok(repo, 'new', slug, '--track', 'fix', '--title', `Fix ${slug}`).data!.worktree as string;
  return wt;
}

/** A fix plan with a recorded repro, advanced to execute, with the fix task started. Returns the plan and task worktrees. */
function fixInExecute(slug: string): { wt: string; swt: string } {
  const wt = newFix(slug);
  ok(wt, 'repro', REPRO);
  ok(wt, 'advance');
  const swt = ok(wt, 'task', 'start', 'fix').data!.worktree as string;
  return { wt, swt };
}

/** Commit changes on the task branch and merge it into the plan branch. */
function landOnTask(wt: string, swt: string, slug: string, files: Record<string, string>) {
  for (const [p, s] of Object.entries(files)) write(join(swt, p), s);
  commitAll(swt, 'fix');
  g(wt, 'merge', '-q', '--no-ff', '-m', 'merge fix', `task/${slug}/fix`);
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
/** A fix record with the five sections and `n` words of prose spread across them. */
const fixRecord = (n: number) => {
  const per = Math.floor(n / 5);
  const bodies = [per, per, per, per, n - 4 * per].map(words);
  return ['Links', 'Bug', 'Cause', 'Fix', 'Evidence'].map((h, i) => `## ${h}\n<!-- a comment that does not count toward the budget -->\n${bodies[i]}\n`).join('\n');
};

before(() => {
  process.env.GIT_AUTHOR_NAME = 't';
  process.env.GIT_AUTHOR_EMAIL = 't@t';
  process.env.GIT_COMMITTER_NAME = 't';
  process.env.GIT_COMMITTER_EMAIL = 't@t';
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-fix-')));
  g(repo, 'init', '-q', '-b', 'main');
  write(join(repo, 'bug.txt'), 'broken\n');
  write(join(repo, 'notes.txt'), 'Notes about the service that a fix may move.\n');
  write(join(repo, '.sdlc/config.json'), JSON.stringify({ test: 'test ! -f ../cairn-test-FAIL', maxParallel: 3 }));
  commitAll(repo, 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

test('new --track fix starts at repro and next routes to the fix procedure', () => {
  const wt = newFix('starts');
  const s = stateOf(wt, 'starts');
  assert.equal(s.track, 'fix');
  assert.equal(s.stage, 'repro');
  assert.match(ok(wt, 'next').data!.procedure as string, /procedures\/fix\.md$/);
});

test('a repro that exits 0 refuses and records nothing', () => {
  const wt = newFix('passes');
  refused(wt, /this does not reproduce the bug/, 'repro', 'true');
  assert.equal(stateOf(wt, 'passes').repro, undefined);
  refused(wt, /no repro is recorded/, 'advance');
  refused(wt, /no repro is recorded/, 'advance', '--not-done', 'skip the repro');
});

test('a failing repro records the command and its last output line', () => {
  const wt = newFix('records');
  ok(wt, 'repro', `echo first; echo "still broken"; ${REPRO}`);
  const s = stateOf(wt, 'records');
  assert.equal(s.repro.cmd, `echo first; echo "still broken"; ${REPRO}`);
  assert.equal(s.repro.tail, 'still broken');
  assert.ok(s.repro.at);
});

test('a repro past its timeout refuses, quotes the error, and records nothing', () => {
  const wt = newFix('hangs');
  write(join(wt, '.sdlc/config.json'), JSON.stringify({ test: 'true', reproTimeoutMinutes: 1 / 60 }));
  commitAll(wt, 'one-second repro timeout');
  const t = Date.now();
  refused(wt, /timed out after 1s/, 'repro', 'sh -c "sleep 2; touch ../orphan-ran"; exit 1');
  assert.ok(Date.now() - t < 10_000, 'the repro was stopped at the timeout');
  assert.equal(stateOf(wt, 'hangs').repro, undefined);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500);
  assert.ok(!existsSync(join(wt, '../orphan-ran')), 'processes the repro started were stopped too');
});

test('a repro command that cannot start refuses and quotes the error', () => {
  const wt = newFix('nostart');
  refused(wt, /could not start.*not found/s, 'repro', 'cairn-no-such-command-xyz');
  assert.equal(stateOf(wt, 'nostart').repro, undefined);
});

test('the repro child environment has no CAIRN_APPROVER', () => {
  const wt = newFix('secret');
  process.env.CAIRN_APPROVER = 'super-secret';
  try {
    ok(wt, 'repro', 'printf "%s" "${CAIRN_APPROVER-unset}" > ../approver.out; exit 1');
  } finally {
    delete process.env.CAIRN_APPROVER;
  }
  assert.equal(readFileSync(join(wt, '../approver.out'), 'utf8'), 'unset');
});

test('repro refuses on a feature plan', () => {
  const wt = ok(repo, 'new', 'feat-repro', '--level', 'standard', '--no-proofs', '--title', 'Feature').data!.worktree as string;
  refused(wt, /fix plan/, 'repro', 'false');
});

test('the full fix track runs repro, execute, review, ship, closed', () => {
  const wt = newFix('full');
  ok(wt, 'repro', REPRO);
  ok(wt, 'advance');
  let s = stateOf(wt, 'full');
  assert.equal(s.stage, 'execute');
  assert.equal(s.phases.length, 1);
  assert.deepEqual(s.phases[0].tasks.map((x: { id: string; scope: string[] }) => [x.id, x.scope]), [['fix', ['**']]]);
  assert.match(ok(wt, 'next').data!.procedure as string, /procedures\/execute\.md$/);

  const swt = ok(wt, 'task', 'start', 'fix').data!.worktree as string;
  landOnTask(wt, swt, 'full', { 'bug.txt': 'fixed\n', 'src/a.ts': 'a\n', 'src/b.ts': 'b\n' });
  ok(wt, 'task', 'done', 'fix');
  s = stateOf(wt, 'full');
  assert.equal(s.phases[0].tasks[0].status, 'done');
  assert.match(ok(wt, 'next').data!.procedure as string, /procedures\/review\.md$/);

  ok(wt, 'advance');
  assert.equal(stateOf(wt, 'full').stage, 'review');
  refused(wt, /zero blocking/, 'advance');
  ok(wt, 'evidence', 'review', 'pass', '--blocking', '0');
  ok(wt, 'advance');
  assert.equal(stateOf(wt, 'full').stage, 'ship');
  assert.match(ok(wt, 'next').data!.procedure as string, /procedures\/ship\.md$/);

  refused(wt, /the pull request is not open/, 'advance');
  setPullRequest(wt, 'full');
  write(join(dirOf(wt, 'full'), 'RECORD.md'), fixRecord(250));
  refused(wt, /250 words; the budget is 200/, 'advance');
  write(join(dirOf(wt, 'full'), 'RECORD.md'), fixRecord(150).replace('## Cause', '## Why'));
  refused(wt, /missing sections: Cause/, 'advance');
  write(join(dirOf(wt, 'full'), 'RECORD.md'), fixRecord(150));
  ok(wt, 'advance');
  s = stateOf(wt, 'full');
  assert.equal(s.stage, 'closed');
  assert.ok(!s.log.some((l: { detail?: string }) => l.detail === 'learn'), 'no learn stage');
  assert.equal(g(wt, 'status', '--porcelain', '--', 'docs/cairn'), '');
});

test('task done refuses while the repro still fails', () => {
  const { wt, swt } = fixInExecute('stillfails');
  landOnTask(wt, swt, 'stillfails', { 'src/a.ts': 'a\n' });
  refused(wt, /repro still fails/, 'task', 'done', 'fix');
});

test('task done counts a repro past its timeout as still failing', () => {
  const wt = newFix('slowfix');
  write(join(wt, '.sdlc/config.json'), JSON.stringify({ test: 'true', reproTimeoutMinutes: 1 / 60 }));
  commitAll(wt, 'one-second repro timeout');
  ok(wt, 'repro', `if grep -q fixed bug.txt; then sleep 20; fi; exit 1`);
  ok(wt, 'advance');
  const swt = ok(wt, 'task', 'start', 'fix').data!.worktree as string;
  landOnTask(wt, swt, 'slowfix', { 'bug.txt': 'fixed\n' });
  refused(wt, /repro still fails.*timed out after 1s/s, 'task', 'done', 'fix');
});

test('task done refuses nine changed files and names escalate', () => {
  const { wt, swt } = fixInExecute('wide');
  const files: Record<string, string> = { 'bug.txt': 'fixed\n' };
  for (let i = 1; i <= 8; i++) files[`src/f${i}.ts`] = `${i}\n`;
  landOnTask(wt, swt, 'wide', files);
  refused(wt, /changed 9 files; a fix may change at most 8[\s\S]*cairn escalate/, 'task', 'done', 'fix');
});

test('a renamed file counts once toward the fix file limit', () => {
  const { wt, swt } = fixInExecute('rename');
  g(swt, 'mv', 'notes.txt', 'notes-moved.txt');
  const files: Record<string, string> = { 'bug.txt': 'fixed\n' };
  for (let i = 1; i <= 6; i++) files[`src/f${i}.ts`] = `${i}\n`;
  // 8 changes when the rename counts once; 9 if it counted as a delete and an add
  landOnTask(wt, swt, 'rename', files);
  ok(wt, 'task', 'done', 'fix');
});

const PRD = `## Problem\np\n## Solution\ns\n## User stories\n1. u\n## Requirements\n- FR-01 x\n## Non-functional requirements\n- n\n## Non-goals\n- g\n## Acceptance criteria\n- FR-01 a\n## Unhappy paths\n- FR-01 u\n## Security considerations\n- s\n## Open questions\n- [x] none\n`;
const PLAN = `## Goal\ng\n## Architecture\na\n## Global constraints\nc\n## Review focus\nr\n## Phases\n\`\`\`yaml cairn-tasks\nphases:\n  - id: core\n    name: Core\n    tasks:\n      - { id: one, name: One, covers: [FR-01], scope: ["src/**"] }\n\`\`\`\n`;

/** A feature plan with an approved plan, in execute. */
function featureInExecute(slug: string): string {
  const wt = ok(repo, 'new', slug, '--level', 'standard', '--no-proofs', '--title', slug).data!.worktree as string;
  const dir = dirOf(wt, slug);
  ok(wt, 'decide', 'q', 'a');
  ok(wt, 'advance');
  write(join(dir, 'prd.md'), PRD);
  byUser(wt, 'approve', 'prd');
  ok(wt, 'advance');
  write(join(dir, 'plan.md'), PLAN);
  ok(wt, 'plan', 'load');
  ok(wt, 'advance');
  return wt;
}

test('escalate turns a fix plan into a feature plan at prd, keeping the task and narrowing its scope', () => {
  const { wt, swt } = fixInExecute('grows');
  landOnTask(wt, swt, 'grows', { 'bug.txt': 'fixed\n', 'src/a.ts': 'a\n' });
  const r = ok(wt, 'escalate');
  assert.match(r.message, /feature plan/);
  const s = stateOf(wt, 'grows');
  assert.equal(s.track, 'feature');
  assert.equal(s.stage, 'prd');
  const sl = s.phases[0].tasks[0];
  assert.equal(sl.id, 'fix');
  assert.equal(sl.status, 'in_progress');
  assert.equal(sl.worktree, swt);
  assert.deepEqual(sl.scope, ['bug.txt', 'src/a.ts']);
  const decisions = readFileSync(join(dirOf(wt, 'grows'), 'decisions.md'), 'utf8');
  assert.match(decisions, /### 1\. .*escalat/i);
  assert.ok(decisions.includes('Fix grows'), 'the bug is recorded');
  assert.ok(decisions.includes(REPRO), 'the repro is recorded');
  assert.match(ok(wt, 'next').data!.procedure as string, /procedures\/prd\.md$/);
  assert.equal(g(wt, 'status', '--porcelain', '--', 'docs/cairn'), '');
});

test('escalate after the fix task is done narrows its scope from the recorded tip', () => {
  const { wt, swt } = fixInExecute('later');
  landOnTask(wt, swt, 'later', { 'bug.txt': 'fixed\n', 'src/b.ts': 'b\n' });
  ok(wt, 'task', 'done', 'fix');
  ok(wt, 'advance');
  ok(wt, 'evidence', 'review', 'pass', '--blocking', '0');
  ok(wt, 'escalate');
  const s = stateOf(wt, 'later');
  assert.equal(s.phases[0].tasks[0].status, 'done');
  assert.deepEqual(s.phases[0].tasks[0].scope, ['bug.txt', 'src/b.ts']);
  assert.equal(s.evidence.review, undefined, 'fix-track review evidence does not carry into the feature plan');
});

test('escalate on a feature plan refuses', () => {
  const wt = ok(repo, 'new', 'feat-escalate', '--level', 'standard', '--no-proofs', '--title', 'Feature').data!.worktree as string;
  refused(wt, /only a fix plan/, 'escalate');
});

test('task start fix from review reopens the fix on a fresh worktree and returns to execute', () => {
  const { wt, swt } = fixInExecute('reopen');
  landOnTask(wt, swt, 'reopen', { 'bug.txt': 'fixed\n', 'src/r1.ts': '1\n', 'src/r2.ts': '2\n', 'src/r3.ts': '3\n' });
  ok(wt, 'task', 'done', 'fix');
  ok(wt, 'advance');
  ok(wt, 'evidence', 'review', 'fail', '--blocking', '1', '--note', 'injection in the fix');
  const before = stateOf(wt, 'reopen');

  const again = ok(wt, 'task', 'start', 'fix').data!.worktree as string;
  const s = stateOf(wt, 'reopen');
  assert.equal(s.stage, 'execute');
  assert.equal(s.evidence.review, undefined);
  assert.deepEqual(s.repro, before.repro);
  assert.equal(s.phases[0].status, 'in_progress');
  assert.equal(s.phases[0].tasks[0].status, 'in_progress');
  assert.equal(s.phases[0].tasks[0].base, before.phases[0].tasks[0].base, 'the file limit still counts the whole fix');
  assert.equal(g(again, 'rev-parse', 'HEAD'), g(wt, 'rev-parse', 'HEAD'), 'the fresh worktree starts from the plan branch');

  // 8 code files across both rounds: plan-state commits between them do not count toward the limit
  landOnTask(wt, again, 'reopen', { 'src/r4.ts': '4\n', 'src/r5.ts': '5\n', 'src/r6.ts': '6\n', 'src/safe.ts': 'safe\n' });
  ok(wt, 'task', 'done', 'fix');
  ok(wt, 'advance');
  assert.equal(stateOf(wt, 'reopen').stage, 'review');
});

test('task start fix outside review refuses once the fix is done', () => {
  const { wt, swt } = fixInExecute('noreopen');
  landOnTask(wt, swt, 'noreopen', { 'bug.txt': 'fixed\n' });
  ok(wt, 'task', 'done', 'fix');
  refused(wt, /already done/, 'task', 'start', 'fix');
});

test('a v0.1 fix plan without a repro keeps the feature stages', () => {
  const wt = newFix('legacy');
  const file = join(dirOf(wt, 'legacy'), 'state.json');
  const st = stateOf(wt, 'legacy');
  // v0.1 started --track fix plans at discover with the feature stages and had no repro or config hash
  Object.assign(st, { stage: 'verify', evidence: { verify: { result: 'pass', at: st.created } } });
  writeFileSync(file, JSON.stringify(st));
  ok(wt, 'advance');
  assert.equal(stateOf(wt, 'legacy').stage, 'review');
  const next = stateOf(wt, 'legacy');
  Object.assign(next, { stage: 'ship', pullRequest: { url: 'https://example.test/pull/1', draft: false, at: st.created, head: 'abc' } });
  writeFileSync(file, JSON.stringify(next));
  ok(wt, 'advance');
  assert.equal(stateOf(wt, 'legacy').stage, 'learn');
});

test('repro checks the stage before it runs anything', () => {
  const { wt } = fixInExecute('late');
  refused(wt, /not repro/, 'repro', 'touch ../late-ran; exit 1');
  assert.ok(!existsSync(join(wt, '../late-ran')));
});

test('a call passes the fix file limit and is recorded; --override is refused', () => {
  const { wt, swt } = fixInExecute('bigfix');
  const files: Record<string, string> = { 'bug.txt': 'fixed\n' };
  for (let i = 1; i <= 8; i++) files[`src/f${i}.ts`] = `${i}\n`;
  landOnTask(wt, swt, 'bigfix', files);
  refused(wt, /changed 9 files[\s\S]*--call/, 'task', 'done', 'fix');
  refused(wt, /--override was removed/, 'task', 'done', 'fix', '--override', 'x');
  ok(wt, 'task', 'done', 'fix', '--call', 'the fix is wide because the rename touches every caller');
  const s = stateOf(wt, 'bigfix');
  assert.equal(s.phases[0].tasks[0].status, 'done');
  assert.equal(s.calls.length, 1);
  assert.match(s.calls[0].what, /changed 9 files/);
  assert.match(s.calls[0].why, /every caller/);
});

test('the fix file limit counts commits on the plan branch outside the plan folder', () => {
  const { wt, swt } = fixInExecute('sidecommits');
  for (let i = 1; i <= 7; i++) write(join(wt, `src/side${i}.ts`), `${i}\n`);
  write(join(wt, 'docs/sdlc/notes.md'), 'notes\n');
  commitAll(wt, 'work committed straight on the plan branch');
  landOnTask(wt, swt, 'sidecommits', { 'bug.txt': 'fixed\n' });
  refused(wt, /changed 9 files/, 'task', 'done', 'fix');
});

test('escalate narrows a running task to its committed and uncommitted files, with glob characters escaped', () => {
  const { wt, swt } = fixInExecute('wip');
  landOnTask(wt, swt, 'wip', { 'bug.txt': 'fixed\n', 'src/we*rd?.ts': 'w\n' });
  write(join(swt, 'src/wip.ts'), 'not committed yet\n');
  write(join(swt, 'notes.txt'), 'edited, not committed\n');
  ok(wt, 'escalate');
  assert.deepEqual(stateOf(wt, 'wip').phases[0].tasks[0].scope, ['bug.txt', 'notes.txt', 'src/we?rd?.ts', 'src/wip.ts']);
});

test('a fix task is never stamped lean: no quick tests, and its report asks for the task review', () => {
  const { wt } = fixInExecute('lean-stamp');
  const tasks = (ok(wt, 'status', '--json', '--full').data!.state as { phases: { tasks: { lean?: boolean }[] }[] }).phases[0].tasks;
  assert.equal(tasks[0].lean, undefined);
});
