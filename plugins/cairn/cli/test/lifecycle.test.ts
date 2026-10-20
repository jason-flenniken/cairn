import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
const state = () => JSON.parse(readFileSync(join(wt, 'docs/sdlc/plans/billing/state.json'), 'utf8'));
const ctxOf = (out: string) => (out ? JSON.parse(out).hookSpecificOutput.additionalContext : '');
const planDir = () => join(wt, 'docs/sdlc/plans/billing');

const PRD = `# Billing PRD
## Problem
p
## Solution
s
## User stories
1. As a user I pay.
## Functional requirements
- FR-01 charge
- FR-02 refund
- FR-03 receipt
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
- [ ] which processor?
`;

const PLAN = `## Goal
g
## Architecture
a
## Global constraints
c
## Review focus
r
## Phases
\`\`\`yaml cairn-slices
phases:
  - id: core
    name: Core
    slices:
      - { id: charge, name: Charge, covers: [FR-01], scope: ["src/charge/**"] }
      - { id: refund, name: Refund, covers: [FR-02], scope: ["src/refund/**"] }
  - id: extras
    name: Extras
    slices:
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
  write(join(repo, '.sdlc/config.json'), JSON.stringify({ test: 'test ! -f ../cairn-test-FAIL', maxParallel: 3 }));
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

test('full lifecycle with every checkpoint', () => {
  // new
  const r = ok(repo, 'new', 'billing', '--title', 'Billing');
  wt = r.data!.worktree as string;
  assert.equal(wt, join(repo, '.claude/worktrees/sdlc-billing'));
  assert.equal(g(wt, 'rev-parse', '--abbrev-ref', 'HEAD'), 'sdlc/billing');
  assert.match(readFileSync(join(repo, '.git/info/exclude'), 'utf8'), /\.claude\/worktrees\//);
  assert.equal(state().stage, 'discover');
  refused(repo, /already exists/, 'new', 'billing');

  // discover -> prd
  refused(wt, /no decisions/, 'advance');
  ok(wt, 'decide', 'Which processor?', 'Stripe', '--why', 'existing account');
  assert.match(readFileSync(join(planDir(), 'decisions.md'), 'utf8'), /### 1\. Which processor\?\n\*\*Decision:\*\* Stripe\n\*\*Why:\*\* existing account/);
  ok(wt, 'advance');
  assert.equal(state().stage, 'prd');

  // prd approval gates
  refused(wt, /prd\.md does not exist/, 'approve', 'prd');
  write(join(planDir(), 'prd.md'), PRD);
  refused(wt, /open question/, 'approve', 'prd');
  refused(wt, /not approved/, 'advance');
  write(join(planDir(), 'prd.md'), PRD.replace('- [ ] which', '- [x] which'));
  ok(wt, 'approve', 'prd');
  ok(wt, 'advance');
  assert.equal(state().stage, 'plan');

  // plan load + approval gates
  write(join(planDir(), 'plan.md'), PLAN.replace(', blocked_by: [charge]', ', blocked_by: [nope]'));
  refused(wt, /nope/, 'plan', 'load');
  write(join(planDir(), 'plan.md'), PLAN);
  ok(wt, 'plan', 'load');
  write(join(planDir(), 'plan.md'), PLAN + '\nedit\n');
  refused(wt, /changed since it was loaded/, 'approve', 'plan');
  ok(wt, 'plan', 'load');
  ok(wt, 'approve', 'plan');
  ok(wt, 'advance');
  assert.equal(state().stage, 'execute');

  // ready set and slice start
  const ready = ok(wt, 'ready').data!.ready as { id: string; model: string }[];
  assert.deepEqual(ready.map((x) => x.id), ['charge', 'refund']);
  refused(wt, /waiting on charge|not in the current phase/, 'slice', 'start', 'receipt');
  const chargeWt = ok(wt, 'slice', 'start', 'charge').data!.worktree as string;
  const refundWt = ok(wt, 'slice', 'start', 'refund').data!.worktree as string;
  assert.ok(existsSync(chargeWt));
  assert.equal(g(chargeWt, 'rev-parse', '--abbrev-ref', 'HEAD'), 'sdlc-slice/billing/charge');

  // drift from a slice worktree is logged against the plan worktree's state
  const out = ctxOf(hookPostEdit({ cwd: wt, tool_input: { file_path: join(chargeWt, 'src/refund/oops.ts') } }));
  assert.match(out, /outside slice "Charge" scope/);
  assert.equal(hookPostEdit({ cwd: chargeWt, tool_input: { file_path: join(chargeWt, 'src/charge/ok.ts') } }), '');
  assert.equal(state().drift.length, 1);

  // a slice with no commits can't be marked done
  g(wt, 'merge', '-q', '--no-ff', '-m', 'noop', 'sdlc-slice/billing/refund');
  refused(wt, /no commits since the slice started/, 'slice', 'done', 'refund');

  // fix rounds circuit breaker
  for (let i = 0; i < 5; i++) ok(wt, 'slice', 'step', 'refund', 'fixing');
  refused(wt, /5 fix rounds/, 'slice', 'step', 'refund', 'fixing');

  // slice done requires merge and green tests
  write(join(chargeWt, 'src/charge/index.ts'), 'export const charge = 1;\n');
  g(chargeWt, 'add', '-A');
  g(chargeWt, 'commit', '-q', '-m', 'charge');
  refused(wt, /not merged/, 'slice', 'done', 'charge');
  g(wt, 'merge', '-q', '--no-ff', '-m', 'merge charge', 'sdlc-slice/billing/charge');
  write(join(wt, 'stray.ts'), 'x');
  refused(wt, /uncommitted changes outside docs\/sdlc/, 'slice', 'done', 'charge');
  rmSync(join(wt, 'stray.ts'));
  write(join(wt, '../cairn-test-FAIL'), 'x');
  refused(wt, /tests are not green/, 'slice', 'done', 'charge');
  rmSync(join(wt, '../cairn-test-FAIL'));
  ok(wt, 'slice', 'done', 'charge');
  assert.ok(!existsSync(chargeWt), 'slice worktree removed');
  assert.equal(state().phases[0].slices[0].status, 'done');

  write(join(refundWt, 'src/refund/index.ts'), 'export const refund = 1;\n');
  g(refundWt, 'add', '-A');
  g(refundWt, 'commit', '-q', '-m', 'refund');
  g(wt, 'merge', '-q', '--no-ff', '-m', 'merge refund', 'sdlc-slice/billing/refund');
  ok(wt, 'slice', 'done', 'refund');
  assert.equal(state().phases[0].status, 'awaiting_approval');

  // phase approval requires drift review
  refused(wt, /drift not reviewed/, 'approve', 'phase');
  ok(wt, 'drift', 'ack', '--all', '--note', 'reverted');
  ok(wt, 'approve', 'phase');
  assert.equal(state().phases[1].status, 'in_progress');

  // pause / resume
  refused(wt, /handoff\.md does not exist/, 'pause');
  write(join(planDir(), 'handoff.md'), '## In flight\nnothing\n## Open questions\nnone\n## Next action\nstart receipt\n');
  ok(wt, 'pause');
  assert.ok(state().paused);
  assert.match(ok(wt, 'next').data!.procedure as string, /procedures\/resume\.md$/);
  assert.equal((ok(wt, 'ready').data!.ready as unknown[]).length, 0);
  refused(wt, /paused/, 'slice', 'start', 'receipt');
  const rec = ok(wt, 'resume');
  assert.match(rec.message, /Resumed "Billing"/);
  assert.equal(state().paused, null);
  ok(wt, 'slice', 'start', 'receipt');

  // session start hook sees the plan from the plan worktree, and the index from main
  assert.match(ctxOf(hookSessionStart({ cwd: wt })), /Billing \(billing\): Execute · phase 2\/2/);
  assert.match(ctxOf(hookSessionStart({ cwd: repo })), /1 active plan/);
  const all = ok(repo, 'status', '--all');
  assert.match(all.message, /Billing/);
  assert.match(ok(repo, 'next').data!.procedure as string, /status\.md$/);

  const receiptWt = state().phases[1].slices[0].worktree;
  write(join(receiptWt, 'src/receipt/index.ts'), 'export const r = 1;\n');
  g(receiptWt, 'add', '-A');
  g(receiptWt, 'commit', '-q', '-m', 'receipt');
  g(wt, 'merge', '-q', '--no-ff', '-m', 'merge receipt', 'sdlc-slice/billing/receipt');
  ok(wt, 'slice', 'done', 'receipt');
  ok(wt, 'approve', 'phase');
  assert.equal(state().stage, 'verify');

  // verify -> review -> ship -> learn -> closed
  refused(wt, /verification has not passed/, 'advance');
  ok(wt, 'evidence', 'verify', 'pass', '--note', 'all criteria covered');
  ok(wt, 'advance');
  refused(wt, /blocking/, 'evidence', 'review', 'pass', '--blocking', '2');
  ok(wt, 'evidence', 'review', 'pass', '--blocking', '0');
  ok(wt, 'advance');
  refused(wt, /RECORD\.md does not exist/, 'approve', 'ship');
  write(join(planDir(), 'RECORD.md'), '## Links\nprd\n## Why\nw\n## What was built\nb\n## How it works\nh\n## Evidence\ne\n## Deviations\nnone\n## Follow-ups\nnone\n');
  ok(wt, 'approve', 'ship');
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
  ok(swt, 'advance', '--override', 'user wants to skip the interview');
  const s = JSON.parse(readFileSync(join(swt, 'docs/sdlc/plans/spike/state.json'), 'utf8'));
  assert.equal(s.stage, 'prd');
  assert.ok(s.log.some((l: { override?: string }) => l.override === 'user wants to skip the interview'));
  assert.match(readFileSync(join(swt, 'docs/sdlc/plans/spike/STATUS.md'), 'utf8'), /## Overrides/);
});

test('edits before the plan is approved are drift', () => {
  const swt = join(repo, '.claude/worktrees/sdlc-spike');
  assert.match(ctxOf(hookPostEdit({ cwd: swt, tool_input: { file_path: join(swt, 'src/app.ts') } })), /before the plan was approved/);
  assert.equal(hookPostEdit({ cwd: swt, tool_input: { file_path: join(swt, 'docs/notes.md') } }), '');
});

test('re-plan from verify adds fix slices, keeps progress, and re-runs verification', () => {
  const r = ok(repo, 'new', 'fixes', '--title', 'Fixes');
  const fwt = r.data!.worktree as string;
  const dir = join(fwt, 'docs/sdlc/plans/fixes');
  ok(fwt, 'decide', 'q', 'a');
  ok(fwt, 'advance');
  write(join(dir, 'prd.md'), PRD.replace('- [ ] which', '- [x] which').replace('- FR-02 refund\n- FR-03 receipt\n', ''));
  ok(fwt, 'approve', 'prd');
  ok(fwt, 'advance');
  const one = (extra = '') => PLAN.replace(/  - id: core[\s\S]*```/, `  - id: core\n    name: Core\n    slices:\n      - { id: charge, name: Charge, covers: [FR-01], scope: ["src/charge/**"] }\n${extra}\`\`\``);
  write(join(dir, 'plan.md'), one());
  ok(fwt, 'plan', 'load');
  ok(fwt, 'approve', 'plan');
  ok(fwt, 'advance');
  const swt = ok(fwt, 'slice', 'start', 'charge').data!.worktree as string;
  write(join(swt, 'src/charge/a.ts'), '1\n');
  g(swt, 'add', '-A');
  g(swt, 'commit', '-q', '-m', 'c');
  g(fwt, 'merge', '-q', '--no-ff', '-m', 'm', 'sdlc-slice/fixes/charge');
  ok(fwt, 'slice', 'done', 'charge');
  ok(fwt, 'approve', 'phase');
  ok(fwt, 'evidence', 'verify', 'fail', '--note', 'double charge');
  refused(fwt, /re-plan/, 'plan', 'load');
  write(join(dir, 'plan.md'), one('  - id: hardening\n    name: Hardening\n    slices:\n      - { id: idempotency, name: Idempotency, covers: [FR-01], scope: ["src/charge/idem/**"] }\n'));
  ok(fwt, 'plan', 'load', '--replan');
  const s = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  assert.equal(s.stage, 'plan');
  assert.equal(s.approvals.plan, undefined);
  assert.equal(s.evidence.verify, undefined);
  assert.equal(s.phases[0].status, 'done');
  assert.equal(s.phases[0].slices[0].status, 'done');
  assert.equal(s.phases[1].status, 'pending');
  ok(fwt, 'approve', 'plan');
  ok(fwt, 'advance');
  assert.deepEqual((ok(fwt, 'ready').data!.ready as { id: string }[]).map((x) => x.id), ['idempotency']);
});
