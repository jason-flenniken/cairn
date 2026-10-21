import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { hookPostEdit, hookSessionStart } from '../src/commands.ts';
import { run } from '../src/main.ts';
import { Refusal } from '../src/util.ts';

let repo: string;
let wt: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const write = (p: string, s: string) => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, s);
};
const ok = (cwd: string, ...argv: string[]) => run(argv, cwd);
const refused = (cwd: string, pattern: RegExp, ...argv: string[]) =>
  assert.throws(() => run(argv, cwd), (e: unknown) => e instanceof Refusal && pattern.test(e.message));
/** Act as the user through the mod: write the hash of a fresh mod secret and pass the secret in CAIRN_APPROVER, as the mod does. */
function asUser<T>(fn: () => T): T {
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
const byUser = (cwd: string, ...argv: string[]) => asUser(() => ok(cwd, ...argv));
const refusedByUser = (cwd: string, pattern: RegExp, ...argv: string[]) => asUser(() => refused(cwd, pattern, ...argv));
const state = () => JSON.parse(readFileSync(join(wt, 'docs/sdlc/plans/billing/state.json'), 'utf8'));
const ctxOf = (out: string) => (out ? JSON.parse(out).hookSpecificOutput.additionalContext : '');
const planDir = () => join(wt, 'docs/sdlc/plans/billing');

const PRD = `# Billing PRD
## Problem
p
## Solution
s
## Requirements
- **FR-01** charge. Check: charged once
- **FR-02** refund. Check: refunded
- **FR-03** receipt. Check: receipt shown
## Non-goals
- crypto
## Open questions
- [ ] which processor?
`;

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
      - { id: charge, name: Charge, covers: [FR-01], scope: ["src/charge/**"] }
      - { id: refund, name: Refund, covers: [FR-02], scope: ["src/refund/**"] }
  - id: extras
    name: Extras
    tasks:
      - { id: receipt, name: Receipt, covers: [FR-03], scope: ["src/receipt/**"], blocked_by: [charge] }
\`\`\`
`;

before(() => {
  process.env.GIT_AUTHOR_NAME = 't';
  process.env.GIT_AUTHOR_EMAIL = 't@t';
  process.env.GIT_COMMITTER_NAME = 't';
  process.env.GIT_COMMITTER_EMAIL = 't@t';
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-')));
  g(repo, 'init', '-q', '-b', 'main');
  write(join(repo, 'README.md'), 'hi\n');
  write(join(repo, '.gitignore'), '.setup-ran\n');
  write(join(repo, '.sdlc/config.json'), JSON.stringify({ setup: 'touch .setup-ran', test: 'test ! -f ../cairn-test-FAIL', maxParallel: 3 }));
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

test('full lifecycle with every checkpoint', () => {
  // new
  const r = ok(repo, 'new', 'billing', '--title', 'Billing');
  wt = r.data!.worktree as string;
  assert.equal(wt, join(repo, '.claude/worktrees/feature-billing'));
  assert.equal(g(wt, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature/billing');
  assert.match(readFileSync(join(repo, '.git/info/exclude'), 'utf8'), /\.claude\/worktrees\//);
  assert.ok(existsSync(join(wt, '.setup-ran')), 'setup ran in the plan worktree');
  assert.equal(state().stage, 'discover');
  refused(repo, /already exists/, 'new', 'billing');
  refused(repo, /already exists \(feature\/billing\)/, 'new', 'billing', '--track', 'fix');

  // a hand-made branch with no plan files is not a plan: left out of the list, and the CLI acts as on main
  const otherWt = join(repo, '.claude/worktrees/feature-other');
  g(repo, 'worktree', 'add', '-q', '-b', 'feature/other', otherWt, 'main');
  const listed = ok(repo, 'status', '--all').data!.plans as { state: { slug: string } }[];
  assert.deepEqual(listed.map((p) => p.state.slug), ['billing']);
  assert.ok(Array.isArray(ok(otherWt, 'status').data!.plans), 'status on a hand-made branch shows the index');
  g(repo, 'worktree', 'remove', '--force', otherWt);

  // a fix plan lands on fix/<slug> in folder fix-<slug>
  const fixed = ok(repo, 'new', 'crash', '--track', 'fix');
  assert.equal(fixed.data!.worktree, join(repo, '.claude/worktrees/fix-crash'));
  assert.equal(g(fixed.data!.worktree as string, 'rev-parse', '--abbrev-ref', 'HEAD'), 'fix/crash');
  refused(repo, /already exists \(fix\/crash\)/, 'new', 'crash');
  g(repo, 'worktree', 'remove', '--force', fixed.data!.worktree as string);
  g(repo, 'branch', '-D', 'fix/crash');

  // discover -> prd
  refused(wt, /no decisions/, 'advance');
  ok(wt, 'decide', 'Which processor?', 'Stripe', '--why', 'existing account');
  assert.match(readFileSync(join(planDir(), 'decisions.md'), 'utf8'), /### 1\. Which processor\?\n\*\*Decision:\*\* Stripe\n\*\*Why:\*\* existing account/);
  ok(wt, 'advance');
  assert.equal(state().stage, 'prd');

  // prd approval gates
  refusedByUser(wt, /prd\.md does not exist/, 'approve', 'prd');
  assert.equal(ok(wt, 'status').data!.ready, undefined);
  write(join(planDir(), 'prd.md'), PRD);
  assert.equal(ok(wt, 'status').data!.ready, undefined, 'open questions block ready');
  refusedByUser(wt, /open question/, 'approve', 'prd');
  refused(wt, /not approved/, 'advance');
  write(join(planDir(), 'prd.md'), PRD.replace('- [ ] which', '- [x] which'));
  const prdReady = ok(wt, 'status').data!.ready as { kind: string; file: string; summary: string };
  assert.equal(prdReady.kind, 'prd');
  assert.equal(prdReady.file, join(planDir(), 'prd.md'));
  assert.match(prdReady.summary, /- FR-01 charge\./);
  assert.equal((ok(repo, 'status', '--all').data!.plans as { ready?: { kind: string } }[])[0].ready?.kind, 'prd');
  byUser(wt, 'approve', 'prd');
  assert.equal(ok(wt, 'status').data!.ready, undefined, 'approved stops are not ready');
  ok(wt, 'advance');
  assert.equal(state().stage, 'plan');

  // plan load + approval gates
  write(join(planDir(), 'plan.md'), PLAN.replace(', blocked_by: [charge]', ', blocked_by: [nope]'));
  refused(wt, /nope/, 'plan', 'load');
  write(join(planDir(), 'plan.md'), PLAN);
  ok(wt, 'plan', 'load');
  write(join(planDir(), 'plan.md'), PLAN + '\nedit\n');
  refusedByUser(wt, /changed since it was loaded/, 'approve', 'plan');
  ok(wt, 'plan', 'load');
  assert.equal((ok(wt, 'status').data!.ready as { kind: string }).kind, 'plan');
  byUser(wt, 'approve', 'plan');
  ok(wt, 'advance');
  assert.equal(state().stage, 'execute');

  // ready set and task start
  const ready = ok(wt, 'ready').data!.ready as { id: string; model: string }[];
  assert.deepEqual(ready.map((x) => x.id), ['charge', 'refund']);
  refused(wt, /waiting on charge|not in the current phase/, 'task', 'start', 'receipt');
  const chargeWt = ok(wt, 'task', 'start', 'charge').data!.worktree as string;
  const refundWt = ok(wt, 'task', 'start', 'refund').data!.worktree as string;
  assert.ok(existsSync(join(chargeWt, '.setup-ran')), 'setup ran in the task worktree');
  assert.equal(g(chargeWt, 'rev-parse', '--abbrev-ref', 'HEAD'), 'task/billing/charge');
  assert.equal(chargeWt, join(repo, '.claude/worktrees/feature-billing--charge'));

  // drift from a task worktree is logged against the plan worktree's state
  const out = ctxOf(hookPostEdit({ cwd: wt, tool_input: { file_path: join(chargeWt, 'src/refund/oops.ts') } }));
  assert.match(out, /outside task "Charge" scope/);
  assert.equal(hookPostEdit({ cwd: chargeWt, tool_input: { file_path: join(chargeWt, 'src/charge/ok.ts') } }), '');
  assert.equal(state().drift.length, 1);
  ok(wt, 'suggest', 'add', '--area', 'tests', '--where', 'src/charge/**', '--where', 'src/refund/**', '--text', 'cover the refund edge');

  // a task with no commits can't be marked done
  g(wt, 'merge', '-q', '--no-ff', '-m', 'noop', 'task/billing/refund');
  refused(wt, /no commits since the task started/, 'task', 'done', 'refund');

  // fix attempts circuit breaker
  for (let i = 0; i < 2; i++) ok(wt, 'task', 'step', 'refund', 'fixing');
  refused(wt, /2 fix attempts/, 'task', 'step', 'refund', 'fixing');

  // task done requires merge and green tests
  write(join(chargeWt, 'src/charge/index.ts'), 'export const charge = 1;\n');
  g(chargeWt, 'add', '-A');
  g(chargeWt, 'commit', '-q', '-m', 'charge');
  refused(wt, /not merged/, 'task', 'done', 'charge');
  g(wt, 'merge', '-q', '--no-ff', '-m', 'merge charge', 'task/billing/charge');
  write(join(wt, 'stray.ts'), 'x');
  refused(wt, /uncommitted changes outside docs\/sdlc/, 'task', 'done', 'charge');
  rmSync(join(wt, 'stray.ts'));
  write(join(wt, '../cairn-test-FAIL'), 'x');
  refused(wt, /tests are not green/, 'task', 'done', 'charge');
  rmSync(join(wt, '../cairn-test-FAIL'));
  ok(wt, 'task', 'done', 'charge');
  assert.ok(!existsSync(chargeWt), 'task worktree removed');
  assert.equal(state().phases[0].tasks[0].status, 'done');

  write(join(refundWt, 'src/refund/index.ts'), 'export const refund = 1;\n');
  g(refundWt, 'add', '-A');
  g(refundWt, 'commit', '-q', '-m', 'refund');
  g(wt, 'merge', '-q', '--no-ff', '-m', 'merge refund', 'task/billing/refund');
  ok(wt, 'task', 'done', 'refund');
  assert.equal(state().phases[0].status, 'awaiting_approval');

  // phase finish needs no human step, lists drift and new suggestions, and moves on
  const fin = ok(wt, 'phase', 'finish');
  assert.match(fin.message, /1 new suggestion \(1 tests\)/);
  assert.match(fin.message, /1 out-of-scope edit/);
  assert.equal(state().phases[0].status, 'done');
  assert.equal(state().phases[1].status, 'in_progress');
  const open = ok(wt, 'suggest', 'list', '--open', '--for', 'src/refund/x.ts');
  assert.match(open.message, /\[tests\] cover the refund edge \(billing:s1/);
  assert.equal(ok(wt, 'suggest', 'list', '--open', '--for', 'docs/**').data!.open, 0);
  assert.equal(ok(wt, 'status').data!.openSuggestions, 1);
  refused(wt, /unfinished tasks/, 'phase', 'finish');

  // pause / resume
  refused(wt, /handoff\.md does not exist/, 'pause');
  write(join(planDir(), 'handoff.md'), '## In flight\nnothing\n## Open questions\nnone\n## Next action\nstart receipt\n');
  ok(wt, 'pause');
  assert.ok(state().paused);
  assert.match(ok(wt, 'next').data!.procedure as string, /procedures\/resume\.md$/);
  assert.equal((ok(wt, 'ready').data!.ready as unknown[]).length, 0);
  refused(wt, /paused/, 'task', 'start', 'receipt');
  const rec = ok(wt, 'resume');
  assert.match(rec.message, /Resumed "Billing"/);
  assert.equal(state().paused, null);
  ok(wt, 'task', 'start', 'receipt');

  // session start hook sees the plan from the plan worktree, and the index from main
  assert.match(ctxOf(hookSessionStart({ cwd: wt })), /Billing \(billing\): Build · phase 2\/2/);
  assert.match(ctxOf(hookSessionStart({ cwd: repo })), /1 active plan/);
  const all = ok(repo, 'status', '--all');
  assert.match(all.message, /Billing/);
  assert.match(ok(repo, 'next').data!.procedure as string, /status\.md$/);

  const receiptWt = state().phases[1].tasks[0].worktree;
  write(join(receiptWt, 'src/receipt/index.ts'), 'export const r = 1;\n');
  g(receiptWt, 'add', '-A');
  g(receiptWt, 'commit', '-q', '-m', 'receipt');
  g(wt, 'merge', '-q', '--no-ff', '-m', 'merge receipt', 'task/billing/receipt');
  ok(wt, 'task', 'done', 'receipt');
  ok(wt, 'phase', 'finish');
  assert.equal(state().stage, 'verify');

  // verify -> review -> ship -> learn -> closed
  refused(wt, /verification has not passed/, 'advance');
  ok(wt, 'evidence', 'verify', 'pass', '--note', 'all criteria covered');
  ok(wt, 'advance');
  refused(wt, /blocking/, 'evidence', 'review', 'pass', '--blocking', '2');
  ok(wt, 'evidence', 'review', 'pass', '--blocking', '0');
  ok(wt, 'advance');
  refusedByUser(wt, /RECORD\.md does not exist/, 'approve', 'ship');
  write(join(planDir(), 'RECORD.md'), '## Links\nprd\n## Why\nw\n## What was built\nb\n## How it works\nh\n## Follow-ups\nnone\n');
  byUser(wt, 'approve', 'ship');
  ok(wt, 'advance');
  ok(wt, 'close');
  assert.equal(state().stage, 'closed');

  // generated status and commit cadence
  const status = readFileSync(join(planDir(), 'STATUS.md'), 'utf8');
  assert.match(status, /\*\*Where we are:\*\* Closed/);
  assert.match(g(wt, 'log', '--oneline'), /cairn\(billing\): closed/);
  assert.equal(g(wt, 'status', '--porcelain', '--', 'docs/sdlc'), '');
});

test('override lets a refused step through and logs the reason', () => {
  const r = ok(repo, 'new', 'spike', '--title', 'Spike');
  const swt = r.data!.worktree as string;
  byUser(swt, 'advance', '--override', 'user wants to skip the interview');
  const s = JSON.parse(readFileSync(join(swt, 'docs/sdlc/plans/spike/state.json'), 'utf8'));
  assert.equal(s.stage, 'prd');
  assert.ok(s.log.some((l: { override?: string }) => l.override === 'user wants to skip the interview'));
  assert.match(readFileSync(join(swt, 'docs/sdlc/plans/spike/STATUS.md'), 'utf8'), /## Overrides/);
});

test('edits before the plan is approved are drift', () => {
  const swt = join(repo, '.claude/worktrees/feature-spike');
  assert.match(ctxOf(hookPostEdit({ cwd: swt, tool_input: { file_path: join(swt, 'src/app.ts') } })), /before the plan was approved/);
  assert.equal(hookPostEdit({ cwd: swt, tool_input: { file_path: join(swt, 'docs/notes.md') } }), '');
});

test('re-plan from verify adds fix tasks, keeps progress, and re-runs verification', () => {
  const r = ok(repo, 'new', 'fixes', '--title', 'Fixes');
  const fwt = r.data!.worktree as string;
  const dir = join(fwt, 'docs/sdlc/plans/fixes');
  ok(fwt, 'decide', 'q', 'a');
  ok(fwt, 'advance');
  write(join(dir, 'prd.md'), PRD.replace('- [ ] which', '- [x] which').replace(/- \*\*FR-0[23]\*\*.*\n/g, ''));
  byUser(fwt, 'approve', 'prd');
  ok(fwt, 'advance');
  const one = (extra = '') => PLAN.replace(/  - id: core[\s\S]*```/, `  - id: core\n    name: Core\n    tasks:\n      - { id: charge, name: Charge, covers: [FR-01], scope: ["src/charge/**"] }\n${extra}\`\`\``);
  write(join(dir, 'plan.md'), one());
  ok(fwt, 'plan', 'load');
  byUser(fwt, 'approve', 'plan');
  ok(fwt, 'advance');
  const swt = ok(fwt, 'task', 'start', 'charge').data!.worktree as string;
  write(join(swt, 'src/charge/a.ts'), '1\n');
  g(swt, 'add', '-A');
  g(swt, 'commit', '-q', '-m', 'c');
  g(fwt, 'merge', '-q', '--no-ff', '-m', 'm', 'task/fixes/charge');
  ok(fwt, 'task', 'done', 'charge');
  ok(fwt, 'phase', 'finish');
  ok(fwt, 'evidence', 'verify', 'fail', '--note', 'double charge');
  refused(fwt, /re-plan/, 'plan', 'load');
  write(join(dir, 'plan.md'), one('  - id: hardening\n    name: Hardening\n    tasks:\n      - { id: idempotency, name: Idempotency, covers: [FR-01], scope: ["src/charge/idem/**"] }\n'));
  ok(fwt, 'plan', 'load', '--replan');
  const s = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  assert.equal(s.stage, 'plan');
  assert.equal(s.approvals.plan, undefined);
  assert.equal(s.evidence.verify, undefined);
  assert.equal(s.phases[0].status, 'done');
  assert.equal(s.phases[0].tasks[0].status, 'done');
  assert.equal(s.phases[1].status, 'pending');
  byUser(fwt, 'approve', 'plan');
  ok(fwt, 'advance');
  assert.deepEqual((ok(fwt, 'ready').data!.ready as { id: string }[]).map((x) => x.id), ['idempotency']);
});

test('a hand-made branch that shares a plan slug is not that plan', () => {
  const r = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-dup-')));
  try {
    g(r, 'init', '-q', '-b', 'main');
    write(join(r, 'README.md'), 'hi\n');
    g(r, 'add', '-A');
    g(r, 'commit', '-q', '-m', 'init');
    const slugs = (cwd: string) => (ok(cwd, 'status', '--all').data!.plans as { state: { slug: string } }[]).map((p) => p.state.slug);

    // (a) a second branch with the plan's slug is not listed twice
    const foo = ok(r, 'new', 'foo').data!.worktree as string;
    g(r, 'branch', 'fix/foo');
    assert.deepEqual(slugs(r), ['foo']);

    // (b) a merged plan's files on main do not make a hand-made fix/foo cut from main a plan
    g(r, 'merge', '-q', '--no-ff', '-m', 'merge foo', 'feature/foo');
    g(r, 'branch', '-D', 'fix/foo');
    g(r, 'worktree', 'remove', '--force', foo);
    g(r, 'branch', '-D', 'feature/foo');
    g(r, 'switch', '-q', '-c', 'fix/foo');
    assert.equal(ok(r, 'status').data!.state, undefined, 'a hand-made branch shows the index, not the merged plan');
    g(r, 'switch', '-q', 'main');
    g(r, 'branch', '-D', 'fix/foo');

    // (c) a legacy sdlc/ plan stays itself when a hand-made feature/ branch shares its slug
    const orig = ok(r, 'new', 'leg').data!.worktree as string;
    const file = join(orig, 'docs/sdlc/plans/leg/state.json');
    write(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), branch: 'sdlc/leg' }));
    g(orig, 'add', '-A');
    g(orig, 'commit', '-q', '-m', 'legacy name');
    g(r, 'worktree', 'remove', '--force', orig);
    g(r, 'branch', '-m', 'feature/leg', 'sdlc/leg');
    const leg = join(r, '.claude/worktrees/sdlc-leg');
    g(r, 'worktree', 'add', '-q', leg, 'sdlc/leg');
    const fake = join(r, '.claude/worktrees/feature-leg');
    g(r, 'worktree', 'add', '-q', '-b', 'feature/leg', fake, 'main');
    assert.deepEqual(slugs(r), ['leg']);
    assert.equal((ok(r, 'status', '--all').data!.plans as { worktree: string }[])[0].worktree, leg);
    assert.equal((ok(leg, 'status').data!.state as { slug: string }).slug, 'leg');
    assert.ok(Array.isArray(ok(fake, 'status').data!.plans), 'the hand-made worktree acts as on main');
    g(r, 'worktree', 'remove', '--force', fake);

    // finding 2: resume checks out the recorded legacy branch, not the hand-made one
    g(r, 'worktree', 'remove', '--force', leg);
    g(r, 'branch', '-D', 'feature/leg');
    g(r, 'branch', 'feature/leg', 'main');
    assert.equal(ok(r, 'resume', 'leg').data!.worktree, leg);
    assert.equal(g(leg, 'rev-parse', '--abbrev-ref', 'HEAD'), 'sdlc/leg');

    // a hand-made feature/bar does not block `new bar --track fix`
    g(r, 'branch', 'feature/bar', 'main');
    assert.equal(g(ok(r, 'new', 'bar', '--track', 'fix').data!.worktree as string, 'rev-parse', '--abbrev-ref', 'HEAD'), 'fix/bar');
    refused(r, /already exists \(sdlc\/leg\)/, 'new', 'leg');
  } finally {
    rmSync(r, { recursive: true, force: true });
  }
});
