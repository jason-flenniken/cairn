import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { hookPostEdit, hookSessionStart } from '../src/commands.ts';
import { parseFindings, reportSuggestions, requirementText, taskSection } from '../src/commands/brief.ts';
import { run } from '../src/main.ts';
import type { State } from '../src/types.ts';
import { Refusal } from '../src/util.ts';
import { pd } from './plandir.ts';

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const write = (p: string, s: string) => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, s);
};
const ok = (cwd: string, ...argv: string[]) => run(argv, cwd);
const refusal = (cwd: string, ...argv: string[]): Refusal => {
  try {
    run(argv, cwd);
  } catch (e) {
    if (e instanceof Refusal) return e;
    throw e;
  }
  throw new assert.AssertionError({ message: `expected a refusal from cairn ${argv.join(' ')}` });
};

const PRD = `# Billing PRD
## Problem
p
## Solution
s
## Requirements
- **FR-01** charge a card once.
  Check: charged once
- **FR-02** refund a charge. Check: refunded
- **FR-03** show a receipt. Check: receipt shown
## Non-goals
- crypto
## Open questions
- [x] which processor?
`;

const PLAN = `## Goal
g
## Architecture
a
## Global constraints
- Amounts are integer cents.
## Phases
\`\`\`yaml cairn-tasks
phases:
  - id: core
    name: Core
    tasks:
      - { id: charge, name: Charge, covers: [FR-01], scope: ["src/charge/**", "docs/cairn/**"] }
      - { id: refund, name: Refund, covers: [FR-02], scope: ["src/refund/**"] }
  - id: extras
    name: Extras
    tasks:
      - { id: receipt, name: Receipt, covers: [FR-03], scope: ["src/receipt/**"], blocked_by: [charge] }
\`\`\`

### Task: charge

**Check:** POST /charge returns 201

### Task: refund

**Check:** POST /refund returns 200

### Task: receipt

**Check:** GET /receipt returns the receipt
`;

interface World {
  repo: string;
  wt: string;
  state: () => State;
  user: <T>(fn: () => T) => T;
}

const roots: string[] = [];
before(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
});
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** A throwaway repo with a plan "billing" at the start of execute. */
function world(config: Record<string, unknown> = {}): World {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-lean-')));
  roots.push(repo);
  g(repo, 'init', '-q', '-b', 'main');
  write(join(repo, 'README.md'), 'hi\n');
  write(join(repo, '.cairn/config.json'), JSON.stringify({ test: 'true', maxParallel: 3, ...config }));
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
  const wt = ok(repo, 'new', 'billing', '--title', 'Billing').data!.worktree as string;
  const dir = pd(wt, 'billing');
  ok(wt, 'decide', 'Which processor?', 'Stripe', '--why', 'existing account');
  ok(wt, 'advance');
  write(join(dir, 'prd.md'), PRD);
  user(() => ok(wt, 'approve', 'prd'));
  ok(wt, 'advance');
  write(join(dir, 'plan.md'), PLAN);
  ok(wt, 'plan', 'load');
  user(() => ok(wt, 'approve', 'plan'));
  ok(wt, 'advance');
  const state = () => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as State;
  assert.equal(state().stage, 'execute');
  return { repo, wt, state, user };
}

const commitIn = (cwd: string, file: string, body: string, msg: string) => {
  write(join(cwd, file), body);
  g(cwd, 'add', '-A');
  g(cwd, 'commit', '-q', '-m', msg);
};
const mergeInProgress = (cwd: string) => {
  try {
    g(cwd, 'rev-parse', '-q', '--verify', 'MERGE_HEAD');
    return true;
  } catch {
    return false;
  }
};

// ---------- parsers ----------

test('plan and PRD lookups: the task section and the requirement text', () => {
  assert.match(taskSection(PLAN, 'refund')!, /^### Task: refund\n\n\*\*Check:\*\* POST \/refund returns 200$/);
  assert.equal(taskSection(PLAN, 'nope'), undefined);
  assert.equal(requirementText(PRD, 'FR-01'), '- **FR-01** charge a card once.\n  Check: charged once');
  assert.equal(requirementText(PRD, 'FR-02'), '- **FR-02** refund a charge. Check: refunded');
  assert.equal(requirementText(PRD, 'FR-09'), undefined);
});

test('parsers are tolerant: prefixes, pre-existing, junk lines, inline and listed suggestions', () => {
  const f = parseFindings('1. Critical | security | injection | a.ts:4 | bad | fix it\n- optional pre-existing | tests | cov | b.ts | p | f\nCritical | only | three\nnot a finding | a | b | c | d | e\n');
  assert.deepEqual(f.map((x) => [x.label, x.preExisting, x.area, x.where]), [['Critical', false, 'security', 'a.ts:4'], ['Optional', true, 'tests', 'b.ts']]);
  assert.deepEqual(reportSuggestions('Suggestions: none\n').length, 0);
  assert.deepEqual(reportSuggestions('Suggestions: tests | src/a/** | add a case\nConcerns: none').map((x) => x.area), ['tests']);
  const listed = reportSuggestions('Tests: ok\nSuggestions:\n- perf | src/b.ts | cache it | really\n2. docs | README.md | explain\nnot | valid\n\nafter: x');
  assert.deepEqual(listed.map((x) => [x.area, x.where, x.text]), [['perf', ['src/b.ts'], 'cache it | really'], ['docs', ['README.md'], 'explain']]);
});

// ---------- briefs ----------

test('task start writes a build brief with the task section and the requirement text', () => {
  const w = world();
  const r = ok(w.wt, 'task', 'start', 'charge');
  const brief = r.data!.brief as string;
  assert.equal(brief, join(w.wt, '.cairn/work/billing/briefs/charge-build.md'));
  assert.equal(r.data!.report, join(w.wt, '.cairn/work/billing/reports/charge-build.md'));
  assert.match(r.message, new RegExp(`\\nBrief: ${brief.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  const md = readFileSync(brief, 'utf8');
  assert.match(md, /### Task: charge/);
  assert.match(md, /POST \/charge returns 201/);
  assert.match(md, /\*\*FR-01\*\* charge a card once\.\n  Check: charged once/);
  assert.doesNotMatch(md, /FR-02/, 'only the covered requirements');
  assert.match(md, /Amounts are integer cents\./);
  assert.match(md, /Task branch: task\/billing\/charge/);
  assert.match(md, /Write your full report to: .*reports\/charge-build\.md/);
  assert.equal(readFileSync(join(w.wt, '.cairn/work/.gitignore'), 'utf8'), '*\n');
  for (const sub of ['briefs', 'reports', 'research']) assert.ok(existsSync(join(w.wt, '.cairn/work/billing', sub)));
  assert.equal(g(w.wt, 'status', '--porcelain', '--', '.', ':!docs'), '', 'the work folder never shows in git');
  // Starting again is a resume: no new brief line.
  assert.doesNotMatch(ok(w.wt, 'task', 'start', 'charge').message, /Brief:/);
  // A review brief names the diff and the build report.
  const rv = ok(w.wt, 'task', 'brief', 'charge', '--role', 'review');
  assert.match(rv.message, /^Brief for review · Charge: .*charge-review\.md\. Report to: .*reports\/charge-review\.md\.$/);
  assert.deepEqual(Object.keys(rv.data!).sort(), ['path', 'report', 'role']);
  const rmd = readFileSync(rv.data!.path as string, 'utf8');
  assert.match(rmd, new RegExp(`git -C ${w.wt} diff feature/billing\\.\\.\\.task/billing/charge`));
  assert.match(rmd, /reports\/charge-build\.md/);
  assert.throws(() => ok(w.wt, 'task', 'brief', 'charge', '--role', 'cook'), /--role must be one of/);
});

test('review record: mixed report sorts into must-fix and follow-ups; the fix brief lists the must-fix', () => {
  const w = world();
  ok(w.wt, 'task', 'start', 'charge');
  const report = join(w.wt, '.cairn/work/billing/reports/charge-review.md');
  write(
    report,
    [
      'Verdict: FIX',
      'Counts: Critical 2, Required 1',
      '',
      '1. Critical | security | injection | src/charge/index.ts:40 | amount is concatenated into SQL | use a bound parameter',
      '2. Required | quality | logic | src/charge/index.ts:12 | retries the charge twice | guard with an idempotency key',
      '3. Optional | tests | coverage | src/charge/index.ts:5 | no test for zero amounts | add one',
      '- Nit | docs | wording | README.md:3 | typo | fix it',
      '5. Critical pre-existing | security | auth | src/old.ts:9 | old hole | later',
      '6. FYI | quality | note | src/x.ts:1 | fyi only | none',
      'Some prose that is not a finding.',
      '7. Bogus | a | b | c | d | e',
      'Optional | quality | too | few',
    ].join('\n'),
  );
  const r = ok(w.wt, 'review', 'record', 'charge', report);
  assert.equal(r.message, 'FIX: 2 must-fix (security: src/charge/index.ts:40; quality: src/charge/index.ts:12); 3 logged as follow-ups.');
  assert.equal(r.data!.verdict, 'FIX');
  assert.equal(r.data!.logged, 3);
  assert.deepEqual((r.data!.mustFix as { label: string; area: string; cls: string; where: string; problem: string; fix: string }[])[0], {
    label: 'Critical', area: 'security', cls: 'injection', where: 'src/charge/index.ts:40', problem: 'amount is concatenated into SQL', fix: 'use a bound parameter',
  });
  const s = w.state();
  assert.equal(s.phases[0].tasks[0].mustFix!.length, 2);
  const open = s.suggestions!.map((x) => [x.area, x.from, x.where]);
  assert.deepEqual(open, [['tests', 'task-review', ['src/charge/index.ts']], ['docs', 'task-review', ['README.md']], ['security', 'task-review', ['src/old.ts']]]);

  // Recording the same file again replaces the must-fix and adds no duplicate follow-ups.
  const again = ok(w.wt, 'review', 'record', 'charge', report);
  assert.match(again.message, /^FIX: 2 must-fix .*; 0 logged as follow-ups\.$/);
  assert.equal(w.state().phases[0].tasks[0].mustFix!.length, 2);
  assert.equal(w.state().suggestions!.length, 3);

  const fix = ok(w.wt, 'task', 'brief', 'charge', '--role', 'fix');
  const md = readFileSync(fix.data!.path as string, 'utf8');
  assert.match(md, /1\. Critical \| security \| injection \| src\/charge\/index\.ts:40 \| amount is concatenated into SQL \| use a bound parameter/);
  assert.match(md, /2\. Required \| quality/);
  assert.doesNotMatch(md, /no test for zero amounts/, 'follow-ups are not must-fix');

  // A later clean review of the same file clears the must-fix.
  write(report, 'Verdict: PASS\n1. Optional | quality | naming | src/charge/index.ts:2 | rename x | rename it\n');
  const pass = ok(w.wt, 'review', 'record', 'charge', report);
  assert.equal(pass.message, 'PASS: 1 logged as follow-ups.');
  assert.equal(w.state().phases[0].tasks[0].mustFix, undefined);

  // A report that says FIX with nothing parseable is refused rather than read as a pass.
  write(report, 'Verdict: FIX\nthe code is wrong somehow\n');
  assert.match(refusal(w.wt, 'review', 'record', 'charge', report).message, /says FIX but has no Critical or Required finding/);
  assert.match(refusal(w.wt, 'review', 'record', 'charge', join(w.wt, 'nope.md')).message, /no report at/);
});

test('review record branch stores the must-fix on the plan state', () => {
  const w = world();
  const report = join(w.wt, '.cairn/work/billing/reports/branch-review.md');
  write(report, 'Verdict: FIX\n1. Required | tests | gap | src/a.ts:1 | nothing tests refunds | add a refund test\n2. Nit | docs | x | README.md | typo | fix\n');
  const r = ok(w.wt, 'review', 'record', 'branch', report);
  assert.equal(r.message, 'FIX: 1 must-fix (tests: src/a.ts:1); 1 logged as follow-ups.');
  const s = w.state();
  assert.equal(s.branchMustFix!.length, 1);
  assert.equal(s.branchMustFix![0].fix, 'add a refund test');
  assert.equal(s.suggestions![0].from, 'branch-review');
  write(report, 'Verdict: PASS\n');
  assert.equal(ok(w.wt, 'review', 'record', 'branch', report).message, 'PASS: 0 logged as follow-ups.');
  assert.equal(w.state().branchMustFix, undefined);
  assert.match(refusal(w.wt, 'review', 'record', 'ghost', report).message, /no task "ghost"/);
});

test('task report logs the implementer suggestions as follow-ups', () => {
  const w = world();
  ok(w.wt, 'task', 'start', 'charge');
  const report = join(w.wt, '.cairn/work/billing/reports/charge-build.md');
  write(report, ['Status: DONE_WITH_CONCERNS', 'Commits: abc1234 charge', 'Tests: npm test -> 3 passed', 'Concerns / questions: one', 'Suggestions:', '- tests | src/charge/** | cover zero amounts', 'perf | src/charge/index.ts | cache the rate', 'bad line', ''].join('\n'));
  const r = ok(w.wt, 'task', 'report', 'charge', report);
  assert.equal(r.message, 'DONE_WITH_CONCERNS; 2 follow-ups logged.');
  assert.deepEqual(r.data, { status: 'DONE_WITH_CONCERNS', logged: 2 });
  assert.deepEqual(w.state().suggestions!.map((x) => [x.area, x.from, x.text]), [['tests', 'implementer', 'cover zero amounts'], ['perf', 'implementer', 'cache the rate']]);
  write(report, 'Status: DONE\nSuggestions: none\n');
  assert.equal(ok(w.wt, 'task', 'report', 'charge', report).message, 'DONE; 0 follow-ups logged.');
  write(report, 'no status here\n');
  assert.match(refusal(w.wt, 'task', 'report', 'charge', report).message, /no Status: line/);
});

// ---------- task merge ----------

test('task merge: a clean merge completes the task', () => {
  const w = world();
  const tw = ok(w.wt, 'task', 'start', 'charge').data!.worktree as string;
  commitIn(tw, 'src/charge/index.ts', 'export const charge = 1;\n', 'charge');
  const r = ok(w.wt, 'task', 'merge', 'charge');
  assert.match(r.message, /^Merged task\/billing\/charge into feature\/billing\.\nTask "Charge" done/);
  assert.equal(w.state().phases[0].tasks[0].status, 'done');
  assert.ok(!existsSync(tw), 'task worktree removed');
  assert.match(g(w.wt, 'log', '--format=%s', '-5'), /^merge task charge$/m);
  assert.ok(existsSync(join(w.wt, 'src/charge/index.ts')));
});

test('task merge: a conflict in code refuses with the files and leaves no merge in progress', () => {
  const w = world();
  commitIn(w.wt, 'src/shared.txt', 'base\n', 'shared');
  const tw = ok(w.wt, 'task', 'start', 'charge').data!.worktree as string;
  commitIn(tw, 'src/shared.txt', 'task side\n', 'task edit');
  commitIn(w.wt, 'src/shared.txt', 'plan side\n', 'plan edit');
  const e = refusal(w.wt, 'task', 'merge', 'charge');
  assert.match(e.message, /conflicts in: src\/shared\.txt/);
  assert.match(e.fixes[0], /cairn task brief charge --role fix.*merge feature\/billing into task\/billing\/charge in .*feature-billing--charge/);
  assert.ok(!mergeInProgress(w.wt), 'merge aborted');
  assert.equal(g(w.wt, 'status', '--porcelain', '--', 'src'), '');
  assert.equal(readFileSync(join(w.wt, 'src/shared.txt'), 'utf8'), 'plan side\n');
  assert.equal(w.state().phases[0].tasks[0].status, 'in_progress');
  const md = readFileSync(ok(w.wt, 'task', 'brief', 'charge', '--role', 'fix').data!.path as string, 'utf8');
  assert.match(md, /Merge feature\/billing into task\/billing\/charge in .*, resolve the conflicts, and commit/);
  assert.match(md, /- src\/shared\.txt/);
  // The fixer merges the plan branch into the task branch and resolves; the next merge goes through.
  g(tw, 'merge', '-q', 'feature/billing', '-m', 'sync', '-X', 'theirs');
  const r = ok(w.wt, 'task', 'merge', 'charge');
  assert.match(r.message, /Merged task\/billing\/charge/);
  assert.equal(w.state().phases[0].tasks[0].status, 'done');
  assert.equal(w.state().phases[0].tasks[0].mergeConflict, undefined);
});

test('task merge: a conflict only under docs/cairn keeps the plan side', () => {
  const w = world();
  commitIn(w.wt, 'docs/cairn/notes.md', 'base\n', 'notes');
  const tw = ok(w.wt, 'task', 'start', 'charge').data!.worktree as string;
  commitIn(tw, 'docs/cairn/notes.md', 'task side\n', 'task notes');
  commitIn(tw, 'src/charge/index.ts', 'export const charge = 1;\n', 'charge');
  commitIn(w.wt, 'docs/cairn/notes.md', 'plan side\n', 'plan notes');
  const r = ok(w.wt, 'task', 'merge', 'charge');
  assert.match(r.message, /Kept the plan's side of 1 plan file that conflicted\./);
  assert.equal(readFileSync(join(w.wt, 'docs/cairn/notes.md'), 'utf8'), 'plan side\n');
  assert.ok(existsSync(join(w.wt, 'src/charge/index.ts')));
  assert.ok(!mergeInProgress(w.wt));
  assert.equal(w.state().phases[0].tasks[0].status, 'done');
});

// ---------- status, next, hooks ----------

test('status --json leaves out the log unless --full', () => {
  const w = world();
  const slim = ok(w.wt, 'status', '--json').data!.state as Record<string, unknown>;
  assert.equal(slim.log, undefined);
  assert.equal(slim.stage, 'execute');
  assert.ok(Array.isArray(slim.phases));
  const full = ok(w.wt, 'status', '--json', '--full').data!.state as { log: unknown[] };
  assert.ok(Array.isArray(full.log) && full.log.length > 0);
  assert.ok(Array.isArray(w.state().log), 'the file on disk keeps its log');
});

test('the start-fresh line: over the limit and recent only; never from a bad file', () => {
  const w = world();
  const file = join(w.repo, '.git/cairn/context/billing.json');
  const put = (pct: number, ageMs = 0) => write(file, JSON.stringify({ pct, tokens: 1000, at: new Date(Date.now() - ageMs).toISOString() }));
  const LINE = 'Context is at 62%. Everything is saved: start fresh with /clear, then /cairn:next.';

  assert.doesNotMatch(ok(w.wt, 'next').message, /Context is at/, 'no file');
  put(62);
  const hot = ok(w.wt, 'next');
  assert.ok(hot.message.endsWith(`\n${LINE}`), hot.message);
  assert.deepEqual(hot.data!.freshStart, { pct: 62 });
  put(20);
  const cool = ok(w.wt, 'next');
  assert.doesNotMatch(cool.message, /Context is at/);
  assert.equal(cool.data!.freshStart, undefined);
  put(90, 11 * 60 * 1000);
  assert.doesNotMatch(ok(w.wt, 'next').message, /Context is at/, 'a stale reading');
  write(file, 'not json');
  assert.doesNotMatch(ok(w.wt, 'next').message, /Context is at/, 'unparseable');
  write(file, JSON.stringify({ pct: 'high', at: 'yesterday' }));
  assert.doesNotMatch(ok(w.wt, 'next').message, /Context is at/, 'wrong shape');

  // The limit is config freshStartAt (default 40).
  put(62);
  write(join(w.wt, '.cairn/config.json'), JSON.stringify({ test: 'true', maxParallel: 3, freshStartAt: 80 }));
  assert.doesNotMatch(ok(w.wt, 'next').message, /Context is at/);
  write(join(w.wt, '.cairn/config.json'), JSON.stringify({ test: 'true', maxParallel: 3, freshStartAt: 50 }));
  assert.match(ok(w.wt, 'next').message, /Context is at 62%/);
  g(w.wt, 'checkout', '-q', '--', '.cairn/config.json');

  // Phase finish and advance say it too.
  put(62);
  for (const id of ['charge', 'refund']) {
    const tw = ok(w.wt, 'task', 'start', id).data!.worktree as string;
    commitIn(tw, `src/${id}/index.ts`, `export const ${id} = 1;\n`, id);
    ok(w.wt, 'task', 'merge', id);
  }
  const fin = ok(w.wt, 'phase', 'finish');
  assert.match(fin.message, /\nContext is at 62%\. Everything is saved: start fresh with \/clear, then \/cairn:next\.$/);
  assert.deepEqual(fin.data!.freshStart, { pct: 62 });
});

test('hooks: edits under .cairn/work are never drift; session start names the work folder', () => {
  const w = world();
  assert.doesNotMatch(String(hookSessionStart({ cwd: w.wt })), /Briefs and reports/, 'nothing yet');
  ok(w.wt, 'task', 'start', 'charge');
  const report = join(w.wt, '.cairn/work/billing/reports/charge-build.md');
  assert.equal(hookPostEdit({ cwd: w.wt, tool_input: { file_path: report } }), '');
  assert.equal(w.state().drift.length, 0);
  assert.equal(hookPostEdit({ cwd: w.wt, tool_input: { file_path: join(w.wt, '.cairn/work/billing/briefs/x.md') } }), '');
  write(report, 'Status: DONE\n');
  const out = JSON.parse(hookSessionStart({ cwd: w.wt })).hookSpecificOutput.additionalContext as string;
  assert.match(out, new RegExp(`\\nBriefs and reports: ${join(w.wt, '.cairn/work/billing').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\n|$)`));
});

test('the Linear queue line points at the background sender', () => {
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(src, /queued: send \$\{n === 1 \? 'it' : 'them'\} with the linear-sender agent in the background \(it follows/);
});
