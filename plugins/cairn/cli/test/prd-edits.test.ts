import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { run } from '../src/main.ts';
import { hashText, Refusal } from '../src/util.ts';
import { pd } from './plandir.ts';

const repos: string[] = [];
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
after(() => repos.forEach((r) => rmSync(r, { recursive: true, force: true })));

const PRD = `# Billing PRD
## Problem
p
## Solution
s
## Requirements
- **FR-01** charge. Check: charged once
## Non-goals
- crypto
## Open questions
- [x] which processor?
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
\`\`\`
`;

let repo: string;
/** Act as the user through the mod, as lifecycle.test.ts does. */
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

/** A fresh repository with one plan whose PRD is approved and whose plan is loaded (the plan stage); returns the plan worktree. */
function atPlanStop(): string {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-prd-edits-')));
  repos.push(repo);
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
  const wt = run(['new', 'billing', '--level', 'standard', '--no-proofs', '--title', 'Billing'], repo).data!.worktree as string;
  run(['decide', 'Which processor?', 'Stripe'], wt);
  run(['advance'], wt);
  writeFileSync(join(pd(wt, 'billing'), 'prd.md'), PRD);
  asUser(() => run(['approve', 'prd'], wt));
  run(['advance'], wt);
  writeFileSync(join(pd(wt, 'billing'), 'plan.md'), PLAN);
  run(['plan', 'load'], wt);
  return wt;
}
const stateOf = (wt: string) => JSON.parse(readFileSync(join(pd(wt, 'billing'), 'state.json'), 'utf8'));
const statusOf = (wt: string) => run(['status'], wt).data as { ready?: { kind: string; summary: string }; warnings: string[] };
const PRD_NOTE = /prd\.md changed after you approved it\. Until you approve it again, the pull request stays a draft/;

test('a PRD edited after the approval is offered again at any stage, and approving it again accepts the edits', () => {
  const wt = atPlanStop();
  const edited = PRD.replace('charge. Check', 'charge by card. Check');
  writeFileSync(join(pd(wt, 'billing'), 'prd.md'), edited);

  const before = statusOf(wt);
  assert.equal(before.ready?.kind, 'prd');
  assert.match(before.ready!.summary, PRD_NOTE);

  // The build is not held up: the plan still advances while the edit waits.
  run(['advance'], wt);
  assert.equal(stateOf(wt).stage, 'execute');
  assert.equal(statusOf(wt).ready?.kind, 'prd', 'the offer outlives the stage');

  const out = asUser(() => run(['approve', 'prd'], wt));
  assert.match(out.message, /approved/i);
  const s = stateOf(wt);
  assert.equal(s.approvals.prd.hash, hashText(edited));
  assert.equal(s.approvals.prd.source, 'mod');
  assert.equal(statusOf(wt).ready, undefined, 'approved again: nothing waits');
});

test('with no PRD edit there is no stop, and approving the PRD again is refused', () => {
  const wt = atPlanStop();
  const prdBefore = stateOf(wt).approvals.prd;
  assert.equal(statusOf(wt).ready, undefined);
  assert.throws(() => asUser(() => run(['approve', 'prd'], wt)), (e: unknown) => e instanceof Refusal && /has not changed since it was approved/.test(e.message));
  assert.deepEqual(stateOf(wt).approvals.prd, prdBefore);
});

test('approve plan, approve ship and approve commands are refused: nothing past the PRD needs the user', () => {
  const wt = atPlanStop();
  for (const [kind, text] of [['plan', /the plan needs no approval/], ['ship', /the ship needs no approval/], ['commands', /need no approval/]] as const)
    assert.throws(() => asUser(() => run(['approve', kind], wt)), (e: unknown) => e instanceof Refusal && text.test(e.message), kind);
  assert.equal(stateOf(wt).approvals.plan, undefined);
});
