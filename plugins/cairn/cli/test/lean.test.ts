import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { hookPostEdit, hookSessionStart } from '../src/commands.ts';
import { parseFindings, parsePrior, reportSuggestions, requirementText, taskSection } from '../src/commands/brief.ts';
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
  assert.match(r.message, new RegExp(`\\nBrief: ${brief.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\nBuilder: sonnet$`));
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

// ---------- review fixes ----------

const RED_TEST = 'if [ -f red.flag ] || [ -f src/charge/red.flag ]; then echo "FAIL src/charge/charge.test.ts: charges twice"; echo "1 failed"; exit 1; fi';
const stateFile = (w: World) => join(pd(w.wt, 'billing'), 'state.json');
const editState = (w: World, fn: (s: State) => void) => {
  const s = w.state();
  fn(s);
  writeFileSync(stateFile(w), JSON.stringify(s, null, 2));
};
const outboxOf = (ids: string[]) =>
  ids.map((id) => ({ id, kind: 'comment' as const, target: 'SAV-1', payload: { issueId: 'SAV-1', body: `note ${id}` }, why: `why ${id}`, dedupe: `d:${id}`, queuedAt: new Date().toISOString() }));
const withOutbox = (w: World, writes: object[]) =>
  editState(w, (s) => {
    s.linear = { team: 'SAV', issues: [], known: [], importedAt: new Date().toISOString(), depends: [], changes: [], outbox: writes as never };
  });

test('linear pending --claim: two senders get disjoint sets, and the queued line counts only what a sender can send', () => {
  const w = world();
  const [a, b, c, d] = outboxOf(['l1', 'l2', 'l3', 'l4']);
  withOutbox(w, [a, b, { ...c, needsApproval: true }, { ...d, held: { at: new Date().toISOString(), note: 'tool missing' } }]);
  const queued = (msg: string) => msg.match(/(\d+) Linear updates? queued/)?.[1];
  assert.equal(queued(ok(w.wt, 'ready').message), '2', 'held and needs-approval entries are not counted');
  const first = ok(w.wt, 'linear', 'pending', '--claim', '--json').data!.pending as { id: string }[];
  assert.deepEqual(first.map((x) => x.id), ['l1', 'l2', 'l4'], 'unsent entries (the held one is tried again), not the one that needs approval');
  const second = ok(w.wt, 'linear', 'pending', '--claim', '--json').data!.pending as { id: string }[];
  assert.deepEqual(second, [], 'a second sender gets nothing');
  assert.equal(queued(ok(w.wt, 'ready').message), undefined, 'claimed entries leave the queued line');
  assert.ok(w.state().linear!.outbox[0].claimedAt);
  // Without --claim the list is unchanged: everything unsent, claimed or not.
  assert.equal((ok(w.wt, 'linear', 'pending').data!.pending as unknown[]).length, 4);
  // sent clears the claim; a claim older than ten minutes is due again.
  ok(w.wt, 'linear', 'sent', 'l1');
  assert.equal(w.state().linear!.outbox[0].claimedAt, undefined);
  editState(w, (s) => {
    s.linear!.outbox[1].claimedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  });
  assert.equal(queued(ok(w.wt, 'ready').message), '1');
  assert.deepEqual((ok(w.wt, 'linear', 'pending', '--claim', '--json').data!.pending as { id: string }[]).map((x) => x.id), ['l2']);
  // A held entry that was claimed and sent is no longer held.
  ok(w.wt, 'linear', 'sent', 'l4');
  assert.equal(w.state().linear!.outbox[3].held, undefined);
});

test('every brief carries the task facts and the PRD and plan paths; the security brief quotes the PRD security section', () => {
  const w = world();
  ok(w.wt, 'task', 'start', 'charge');
  const dir = pd(w.wt, 'billing');
  const build = readFileSync(join(w.wt, '.cairn/work/billing/briefs/charge-build.md'), 'utf8');
  assert.match(build, /## Task facts\n\n- Scope: src\/charge\/\*\*, docs\/cairn\/\*\*\n- Risky: no\n- Complexity: standard\n- Blocked by: nothing\n/);
  assert.ok(build.includes(`- PRD: ${join(dir, 'prd.md')}\n- Plan: ${join(dir, 'plan.md')}\n`));
  const sec0 = readFileSync(ok(w.wt, 'task', 'brief', 'charge', '--role', 'security').data!.path as string, 'utf8');
  assert.match(sec0, /## PRD security section\n\n\(the PRD has no Security section/);
  write(join(dir, 'prd.md'), `${PRD}\n## Security\n- Misuse case: replaying a charge request. Control: idempotency key.\n`);
  const sec = readFileSync(ok(w.wt, 'task', 'brief', 'charge', '--role', 'security').data!.path as string, 'utf8');
  assert.match(sec, /## PRD security section\n\n- Misuse case: replaying a charge request\. Control: idempotency key\./);
  assert.match(sec, /- Scope: src\/charge/);
  const review = readFileSync(ok(w.wt, 'task', 'brief', 'charge', '--role', 'review').data!.path as string, 'utf8');
  assert.doesNotMatch(review, /PRD security section/);
  const fix = readFileSync(ok(w.wt, 'task', 'brief', 'charge', '--role', 'fix').data!.path as string, 'utf8');
  assert.match(fix, /## Task facts/);
  assert.ok(fix.includes(join(dir, 'plan.md')));
  const later = ok(w.wt, 'task', 'brief', 'receipt');
  assert.match(readFileSync(later.data!.path as string, 'utf8'), /- Blocked by: charge\n/);
});

test('task merge: a dirty task worktree refuses before any merge, leaving no merge commit on the plan branch', () => {
  const w = world();
  const tw = ok(w.wt, 'task', 'start', 'charge').data!.worktree as string;
  commitIn(tw, 'src/charge/index.ts', 'export const charge = 1;\n', 'charge');
  write(join(tw, 'src/charge/scratch.ts'), 'wip\n');
  const planTip = g(w.wt, 'rev-parse', 'HEAD');
  const e = refusal(w.wt, 'task', 'merge', 'charge');
  assert.match(e.message, /task worktree has uncommitted changes/);
  assert.equal(g(w.wt, 'rev-parse', 'HEAD'), planTip, 'the plan branch did not move');
  assert.doesNotMatch(g(w.wt, 'log', '--format=%s', '-5'), /merge task/);
  assert.equal(w.state().phases[0].tasks[0].status, 'in_progress');
  // No commits at all is refused the same way, and stray edits in the plan worktree too.
  rmSync(join(tw, 'src/charge/scratch.ts'));
  const w2 = world();
  ok(w2.wt, 'task', 'start', 'charge');
  assert.match(refusal(w2.wt, 'task', 'merge', 'charge').message, /has no commits since the task started/);
  const w3 = world();
  const tw3 = ok(w3.wt, 'task', 'start', 'charge').data!.worktree as string;
  commitIn(tw3, 'src/charge/index.ts', 'x\n', 'charge');
  write(join(w3.wt, 'loose.txt'), 'x\n');
  const tip3 = g(w3.wt, 'rev-parse', 'HEAD');
  assert.match(refusal(w3.wt, 'task', 'merge', 'charge').message, /plan worktree has uncommitted changes outside cairn's files/);
  assert.equal(g(w3.wt, 'rev-parse', 'HEAD'), tip3);
});

test('a red task done writes tests.log, records lastRed, and the fix brief shows it; a green run clears it', () => {
  const w = world({ test: RED_TEST });
  const tw = ok(w.wt, 'task', 'start', 'charge').data!.worktree as string;
  commitIn(tw, 'src/charge/index.ts', 'export const charge = 1;\n', 'charge');
  commitIn(tw, 'src/charge/red.flag', 'x\n', 'break it');
  const e = refusal(w.wt, 'task', 'merge', 'charge');
  const log = join(w.wt, '.cairn/work/billing/reports/tests.log');
  assert.match(e.message, /^tests are not green \(.*\)\. Full output: .*tests\.log$/);
  assert.ok(e.message.endsWith(`Full output: ${log}`));
  assert.match(e.fixes[0], /the merge stays in place/);
  assert.match(e.fixes[0], new RegExp(`In ${tw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, merge `), 'the fix goes on the task branch in the task worktree');
  assert.doesNotMatch(e.fixes[0], /Fix on the merged tree/);
  assert.match(readFileSync(log, 'utf8'), /FAIL src\/charge\/charge\.test\.ts: charges twice/);
  const red = w.state().lastRed!;
  assert.equal(red.log, log);
  assert.deepEqual(red.failing, ['FAIL src/charge/charge.test.ts: charges twice', '1 failed']);
  assert.match(g(w.wt, 'log', '--format=%s', '-3'), /merge task charge/, 'the merge is in place');
  assert.equal(w.state().phases[0].tasks[0].status, 'in_progress');
  const md = readFileSync(ok(w.wt, 'task', 'brief', 'charge', '--role', 'fix').data!.path as string, 'utf8');
  assert.match(md, /## Last red test run\n\n  FAIL src\/charge\/charge\.test\.ts: charges twice\n  1 failed\nFull output: .*tests\.log/);
  // The fix is an in-scope commit on the task branch (after merging the plan branch in): the next merge takes it,
  // is not refused as a stray commit on the plan branch, and runs a green task done that clears the record.
  g(tw, 'merge', '-q', g(w.wt, 'rev-parse', '--abbrev-ref', 'HEAD'));
  g(tw, 'rm', '-q', 'src/charge/red.flag');
  g(tw, 'commit', '-q', '-m', 'fix');
  const done = ok(w.wt, 'task', 'merge', 'charge');
  assert.match(done.message, /^Merged /);
  assert.equal(w.state().phases[0].tasks[0].status, 'done');
  assert.equal(w.state().lastRed, undefined);
});

test('cairn test: a red run logs and records lastRed; the build runs too and both are reported', () => {
  const w = world({ test: RED_TEST, build: 'echo compiled ok' });
  write(join(w.wt, 'red.flag'), 'x\n');
  const r = ok(w.wt, 'test');
  assert.match(r.message, /^Tests RED/);
  assert.match(r.message, /Full output: .*tests\.log\nBuild green \(`echo compiled ok` → compiled ok\)\.$/);
  assert.equal(w.state().lastRed!.log, r.data!.log);
  assert.deepEqual(r.data!.build, { ran: true, ok: true, command: 'echo compiled ok', summary: 'compiled ok' });
  rmSync(join(w.wt, 'red.flag'));
  const green = ok(w.wt, 'test');
  assert.match(green.message, /^Tests green \(.*\)\. Build green/);
  assert.equal(w.state().lastRed, undefined);
  const bad = world({ build: 'echo no >&2; exit 3' });
  assert.match(ok(bad.wt, 'test').message, /^Tests green .*\. Build RED \(`echo no >&2; exit 3` → no\)\.$/);
});

test('cairn new keeps the work folder out of git before any task starts', () => {
  const w = world();
  assert.match(readFileSync(join(w.repo, '.git/info/exclude'), 'utf8'), /^\.cairn\/work\/$/m);
  mkdirSync(join(w.wt, '.cairn/work/billing/reports'), { recursive: true });
  write(join(w.wt, '.cairn/work/billing/reports/early.md'), 'written before execute\n');
  assert.equal(g(w.wt, 'status', '--porcelain', '--', '.', ':!docs'), '');
});

const reviewReport = (w: World, name: string, lines: string[]) => {
  const p = join(w.wt, '.cairn/work/billing/reports', name);
  write(p, lines.join('\n'));
  return p;
};

test('re-review: the brief lists the prior must-fix and reuses the report path; Prior lines keep open items and clear addressed ones', () => {
  const w = world();
  ok(w.wt, 'task', 'start', 'charge');
  const report = reviewReport(w, 'charge-review.md', [
    'Verdict: FIX',
    '1. Critical | security | injection | src/charge/index.ts:40 | amount is concatenated into SQL | use a bound parameter',
    '2. Required | quality | logic | src/charge/index.ts:12 | retries the charge twice | guard it',
  ]);
  ok(w.wt, 'review', 'record', 'charge', report);
  const b = ok(w.wt, 'task', 'brief', 'charge', '--role', 'review', '--again');
  assert.equal(b.data!.report, report, 'the same report path as the first review');
  assert.match(b.message, /^Brief for re-review · Charge: .*charge-review-again\.md\. Report to: .*charge-review\.md\.$/);
  const md = readFileSync(b.data!.path as string, 'utf8');
  assert.match(md, /^# Re-review: Charge \(charge\)/);
  assert.match(md, /1\. Critical \| security \| injection \| src\/charge\/index\.ts:40/);
  assert.match(md, /2\. Required \| quality \| logic \| src\/charge\/index\.ts:12/);
  assert.match(md, /The fix report: .*reports\/charge-fix\.md/);
  assert.match(md, /Prior: <path:line> \| addressed\|open/);
  assert.match(md, new RegExp(`Write your full report to: ${report.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  // One item still open, one addressed, and a new breakage as a normal line.
  write(report, ['Verdict: FIX', 'Prior: src/charge/index.ts:40 | open | still concatenated', 'Prior: src/charge/index.ts:12 | addressed | guarded now', '1. Required | tests | gap | src/charge/new.ts:3 | fix broke refunds | restore it'].join('\n'));
  const r = ok(w.wt, 'review', 'record', 'charge', report);
  assert.equal(r.message, 'FIX: 2 must-fix (tests: src/charge/new.ts:3; security: src/charge/index.ts:40); 0 logged as follow-ups.');
  const must = w.state().phases[0].tasks[0].mustFix!;
  const kept = must.find((x) => x.where === 'src/charge/index.ts:40')!;
  assert.deepEqual([kept.label, kept.area, kept.cls, kept.problem, kept.fix], ['Critical', 'security', 'injection', 'still concatenated', 'use a bound parameter']);
  assert.ok(!must.some((x) => x.where === 'src/charge/index.ts:12'), 'the addressed item is gone');
  // Everything addressed: PASS, and a verdict FIX with only open Prior lines is not refused.
  write(report, 'Verdict: FIX\nPrior: src/charge/index.ts:40 | open | nope\n');
  assert.match(ok(w.wt, 'review', 'record', 'charge', report).message, /^FIX: 1 must-fix/);
  write(report, 'Verdict: PASS\nPrior: src/charge/index.ts:40 | addressed | done\n');
  assert.equal(ok(w.wt, 'review', 'record', 'charge', report).message, 'PASS: 0 logged as follow-ups.');
  assert.equal(w.state().phases[0].tasks[0].mustFix, undefined);
  // Security re-review writes to the security report; --again needs a reviewing role.
  assert.match(ok(w.wt, 'task', 'brief', 'charge', '--role', 'security', '--again').data!.report as string, /reports\/charge-security\.md$/);
  assert.throws(() => ok(w.wt, 'task', 'brief', 'charge', '--again'), /--again needs --role review or --role security/);
  // Branch re-review: the same file replaces the branch must-fix.
  const br = reviewReport(w, 'branch-review.md', ['Verdict: FIX', '1. Required | tests | gap | src/a.ts:1 | nothing tests refunds | add one']);
  ok(w.wt, 'review', 'record', 'branch', br);
  assert.equal(w.state().branchMustFix!.length, 1);
  write(br, 'Verdict: PASS\nPrior: src/a.ts:1 | addressed | test added\n');
  ok(w.wt, 'review', 'record', 'branch', br);
  assert.equal(w.state().branchMustFix, undefined);
});

test('MVP: review record files Optional, Nit and pre-existing findings as hardening items', () => {
  const w = world();
  w.user(() => ok(w.wt, 'level', 'mvp'));
  ok(w.wt, 'task', 'start', 'charge');
  const report = reviewReport(w, 'charge-review.md', [
    'Verdict: PASS',
    '1. Optional | tests | coverage | src/charge/index.ts:5 | no test for zero amounts | add one',
    '2. Nit | docs | wording | n/a | typo | fix it',
    '3. Critical pre-existing | security | auth | src/old.ts:9 | old hole | later',
  ]);
  const r = ok(w.wt, 'review', 'record', 'charge', report);
  assert.equal(r.message, 'PASS: 3 logged as follow-ups.');
  const items = w.state().suggestions!;
  assert.deepEqual(items.map((x) => x.kind), ['hardening', 'hardening', 'hardening']);
  assert.deepEqual(items[0].where, ['src/charge/index.ts']);
  assert.deepEqual(items[1].where, ['src/charge/**', 'docs/cairn/**', 'src/refund/**', 'src/receipt/**'], 'no path: the plan scope');
  assert.deepEqual(items[2].where, ['src/old.ts']);
  assert.equal(ok(w.wt, 'status', '--json').data!.hardeningItems, 3);
  // Recording again adds nothing; at Standard the same lines are ordinary follow-ups.
  assert.match(ok(w.wt, 'review', 'record', 'charge', report).message, /0 logged/);
  const std = world();
  ok(std.wt, 'task', 'start', 'charge');
  ok(std.wt, 'review', 'record', 'charge', reviewReport(std, 'charge-review.md', ['Verdict: PASS', '1. Optional | tests | coverage | src/charge/index.ts:5 | no test | add one']));
  assert.equal(std.state().suggestions![0].kind, undefined);
});

test('the fix brief groups the must-fix by class', () => {
  const w = world();
  ok(w.wt, 'task', 'start', 'charge');
  const report = reviewReport(w, 'charge-review.md', [
    'Verdict: FIX',
    '1. Critical | security | injection | a.ts:1 | sql | bind it',
    '2. Required | quality | logic | b.ts:2 | retry | guard',
    '3. Required | security | injection | c.ts:3 | shell | quote it',
  ]);
  ok(w.wt, 'review', 'record', 'charge', report);
  const md = readFileSync(ok(w.wt, 'task', 'brief', 'charge', '--role', 'fix').data!.path as string, 'utf8');
  assert.match(md, /### injection\n\n1\. Critical \| security \| injection \| a\.ts:1 \| sql \| bind it\n2\. Required \| security \| injection \| c\.ts:3 \| shell \| quote it\n\n### logic\n\n3\. Required \| quality \| logic \| b\.ts:2 \| retry \| guard\n/);
});

test('review record: security is decided by the file name, relative paths resolve, rows and class-less lines parse', () => {
  const w = world();
  ok(w.wt, 'task', 'start', 'charge');
  // A folder called "security" does not make a task review a security review.
  const dir = join(w.wt, '.cairn/work/billing/reports/security');
  write(join(dir, 'charge-review.md'), 'Verdict: PASS\n1. Optional | tests | cov | a.ts:1 | gap | add\n');
  ok(w.wt, 'review', 'record', 'charge', '.cairn/work/billing/reports/security/charge-review.md');
  write(join(w.wt, '.cairn/work/billing/reports/charge-security.md'), 'Verdict: PASS\n1. Optional | security | hdr | b.ts:1 | header | add\n');
  ok(w.wt, 'review', 'record', 'charge', join(w.wt, '.cairn/work/billing/reports/../reports/charge-security.md'));
  assert.deepEqual(w.state().suggestions!.map((x) => x.from), ['task-review', 'security-review']);
  write(join(w.wt, '.cairn/work/billing/reports/branch-security.md'), 'Verdict: FIX\n1. Required | security | authz | c.ts:2 | open route | guard it\n');
  const rel = ok(w.wt, 'review', 'record', 'branch', '.cairn/work/billing/reports/branch-security.md');
  assert.equal(w.state().branchMustFix![0].report, join(w.wt, '.cairn/work/billing/reports/branch-security.md'), 'stored as an absolute path');
  assert.equal(rel.data!.verdict, 'FIX');
  const f = parseFindings(['| Critical | security | injection | a.ts:4 | bad | fix it |', '| 2 | **Required** | quality | b.ts:1 | slow | cache |', '3. Required | quality | c.ts:9 | no class here | fix here', '| Optional | tests | cov | d.ts:2 | only four |', '| Prior | a | b |'].join('\n'));
  assert.deepEqual(f.map((x) => [x.label, x.area, x.cls, x.where, x.problem, x.fix]), [
    ['Critical', 'security', 'injection', 'a.ts:4', 'bad', 'fix it'],
    ['Required', 'quality', 'unclassified', 'b.ts:1', 'slow', 'cache'],
    ['Required', 'quality', 'unclassified', 'c.ts:9', 'no class here', 'fix here'],
    ['Optional', 'tests', 'cov', 'd.ts:2', 'only four', ''],
  ]);
});

test('status --json drops the follow-up list and the Linear payloads unless --full; status --all keeps what the pane reads', () => {
  const w = world();
  withOutbox(w, outboxOf(['l1']));
  editState(w, (s) => {
    s.suggestions = [{ id: 's1', area: 'tests', text: 'cover it', where: ['src/**'], from: 'implementer', at: new Date().toISOString() }];
  });
  const slim = ok(w.wt, 'status', '--json').data!;
  const st = slim.state as State;
  assert.equal(st.suggestions, undefined);
  assert.equal(st.log, undefined);
  assert.equal(st.linear!.outbox.length, 1);
  assert.equal((st.linear!.outbox[0] as { payload?: unknown }).payload, undefined);
  assert.equal(st.linear!.outbox[0].why, 'why l1');
  assert.deepEqual(slim.suggestionCounts, { logged: 1, open: 1, hardening: 0 });
  const full = ok(w.wt, 'status', '--json', '--full').data!.state as State;
  assert.equal(full.suggestions!.length, 1);
  assert.ok((full.linear!.outbox[0] as { payload?: unknown }).payload);
  assert.ok(Array.isArray(full.log));
  // The pane and the approval menus read these from `status --all --json`.
  const row = (ok(w.wt, 'status', '--all', '--json').data!.plans as { state: State; worktree: string; dir: string; ready?: unknown; next: unknown; level: string; linearDue?: number }[])[0];
  assert.equal(row.state.slug, 'billing');
  assert.equal(row.state.stage, 'execute');
  assert.ok(Array.isArray(row.state.phases) && row.state.phases[0].tasks.length > 0);
  assert.ok(row.state.approvals.prd && row.state.updated);
  assert.ok(Array.isArray(row.state.log) && row.state.log.length > 0, 'the pane builds its recent-activity feed from the log');
  assert.equal(row.state.suggestions, undefined);
  assert.equal((row.state.linear!.outbox[0] as { payload?: unknown }).payload, undefined);
  assert.equal(row.worktree, w.wt);
  assert.ok(row.dir && row.next && row.level);
  assert.equal(row.linearDue, 1);
});

// ---------- second review fixes ----------

test('cairn next and the session-start line count what a sender can take, not what a running sender holds', () => {
  const w = world();
  const [a, b, c] = outboxOf(['l1', 'l2', 'l3']);
  withOutbox(w, [a, b, { ...c, needsApproval: true }]);
  assert.match(ok(w.wt, 'next').message, /Send 3 queued Linear updates first/);
  ok(w.wt, 'linear', 'pending', '--claim', '--json');
  const after = ok(w.wt, 'next');
  assert.match(after.message, /Send 1 queued Linear update first/, 'only the one that needs the user is left for the main thread');
  assert.match(String(hookSessionStart({ cwd: w.wt })), /1 Linear update waiting to be sent/);
  ok(w.wt, 'linear', 'hold', 'l3', '--note', 'later');
  editState(w, (s) => {
    for (const x of s.linear!.outbox) delete x.needsApproval;
  });
  assert.doesNotMatch(ok(w.wt, 'next').message, /queued Linear update/, 'claimed and held entries do not route to the sync');
});

test('linear pending --claim hands out held entries again; sent and a new hold clear the old note', () => {
  const w = world();
  const [a] = outboxOf(['l1']);
  withOutbox(w, [{ ...a, held: { at: new Date().toISOString(), note: 'no tools' } }]);
  const got = ok(w.wt, 'linear', 'pending', '--claim', '--json').data!.pending as { id: string }[];
  assert.deepEqual(got.map((x) => x.id), ['l1']);
  ok(w.wt, 'linear', 'hold', 'l1', '--note', 'failed again');
  assert.equal(w.state().linear!.outbox[0].held!.note, 'failed again');
  assert.equal(w.state().linear!.outbox[0].claimedAt, undefined);
  assert.deepEqual((ok(w.wt, 'linear', 'pending', '--claim', '--json').data!.pending as { id: string }[]).map((x) => x.id), ['l1']);
});

test('a red merge belongs to its task: another task is refused before merging, and its fix brief leaves the red run out', () => {
  const w = world({ test: RED_TEST });
  const tc = ok(w.wt, 'task', 'start', 'charge').data!.worktree as string;
  const tr = ok(w.wt, 'task', 'start', 'refund').data!.worktree as string;
  commitIn(tc, 'src/charge/index.ts', 'export const charge = 1;\n', 'charge');
  commitIn(tc, 'src/charge/red.flag', 'x\n', 'break it');
  commitIn(tr, 'src/refund/index.ts', 'export const refund = 1;\n', 'refund');
  refusal(w.wt, 'task', 'merge', 'charge');
  assert.equal(w.state().lastRed!.task, 'charge');
  const planTip = g(w.wt, 'rev-parse', 'HEAD');
  const e = refusal(w.wt, 'task', 'merge', 'refund');
  assert.match(e.message, /^the plan branch is red from task Charge's merge: fix that first/);
  assert.equal(g(w.wt, 'rev-parse', 'HEAD'), planTip, 'nothing was merged');
  const own = readFileSync(ok(w.wt, 'task', 'brief', 'charge', '--role', 'fix').data!.path as string, 'utf8');
  assert.match(own, /## Last red test run/);
  assert.doesNotMatch(own, /No must-fix findings are recorded/, 'the red run is the fix, so the empty-findings line is left out');
  const other = readFileSync(ok(w.wt, 'task', 'brief', 'refund', '--role', 'fix').data!.path as string, 'utf8');
  assert.doesNotMatch(other, /Last red test run/);
  assert.match(other, /No must-fix findings are recorded/);
  // A plan-level run (no task owns it) still shows in a fix brief.
  editState(w, (s) => {
    delete s.lastRed!.task;
  });
  assert.match(readFileSync(ok(w.wt, 'task', 'brief', 'refund', '--role', 'fix').data!.path as string, 'utf8'), /Last red test run/);
});

test('task merge refuses on a paused plan before merging', () => {
  const w = world();
  const tw = ok(w.wt, 'task', 'start', 'charge').data!.worktree as string;
  commitIn(tw, 'src/charge/index.ts', 'export const charge = 1;\n', 'charge');
  editState(w, (s) => {
    s.paused = { at: new Date().toISOString(), mode: 'drain' };
  });
  const tip = g(w.wt, 'rev-parse', 'HEAD');
  const e = refusal(w.wt, 'task', 'merge', 'charge');
  assert.match(e.message, /the plan is paused: let running steps finish/);
  assert.match(e.fixes.join(), /\/cairn:resume continues/);
  assert.equal(g(w.wt, 'rev-parse', 'HEAD'), tip);
});

test('review finding locations in backticks or asterisks match the stored location; MVP files the bare path', () => {
  const md = [
    '1. Required | quality | naming | `src/x.ts:40` | the name lies | rename it',
    '2. Optional | quality | naming | **src/y.ts:7** | a nit | tidy',
    'Prior: `src/x.ts:40` | open | still wrong',
  ].join('\n');
  const f = parseFindings(md);
  assert.deepEqual(f.map((x) => x.where), ['src/x.ts:40', 'src/y.ts:7']);
  assert.equal(parsePrior(md)[0].where, 'src/x.ts:40');
  const w = world();
  const rep = join(w.wt, '.cairn/work/billing/reports/charge-review.md');
  write(rep, md.split('\n').slice(0, 2).join('\n'));
  ok(w.wt, 'review', 'record', 'charge', rep);
  write(rep, 'Verdict: FIX\nPrior: `src/x.ts:40` | open | still wrong\n');
  ok(w.wt, 'review', 'record', 'charge', rep);
  const must = w.state().phases[0].tasks[0].mustFix!;
  assert.equal(must.length, 1);
  assert.equal(must[0].where, 'src/x.ts:40');
  assert.equal(must[0].fix, 'rename it', 'the open prior item kept what the first review said');
  w.user(() => ok(w.wt, 'level', 'mvp'));
  write(rep, '1. Optional | quality | naming | `src/z.ts:3` | a z nit | tidy\n');
  ok(w.wt, 'review', 'record', 'charge', rep);
  assert.deepEqual(w.state().suggestions!.find((x) => x.text.startsWith('a z nit') && x.kind === 'hardening' && x.where.includes('src/z.ts'))?.where, ['src/z.ts']);
});
