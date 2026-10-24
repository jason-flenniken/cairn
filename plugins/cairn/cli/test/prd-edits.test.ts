import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { run } from '../src/main.ts';
import { hashText } from '../src/util.ts';
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
  writeFileSync(join(repo, '.git/cairn/mod-secret.sha256'), createHash('sha256').update(secret).digest('hex'), { mode: 0o600 });
  process.env.CAIRN_APPROVER = secret;
  try {
    return fn();
  } finally {
    delete process.env.CAIRN_APPROVER;
  }
}

/** A fresh repository with one plan whose PRD is approved and whose plan is loaded; returns the plan worktree. */
function atPlanStop(): string {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-prd-edits-')));
  repos.push(repo);
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
  const wt = run(['new', 'billing', '--title', 'Billing'], repo).data!.worktree as string;
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
const PRD_NOTE = /prd\.md changed after you approved it; approving the plan also accepts those edits/;

test('a PRD edited while planning is named on the plan stop, and approving the plan accepts the edits', () => {
  const wt = atPlanStop();
  const edited = PRD.replace('charge. Check', 'charge by card. Check');
  writeFileSync(join(pd(wt, 'billing'), 'prd.md'), edited);

  const before = statusOf(wt);
  assert.equal(before.ready?.kind, 'plan');
  assert.match(before.ready!.summary, PRD_NOTE);
  assert.ok(before.warnings.includes('prd.md changed after it was approved: approving the plan accepts the edits'));

  const out = asUser(() => run(['approve', 'plan'], wt));
  assert.match(out.message, /PRD edits with it/);
  const s = stateOf(wt);
  assert.equal(s.approvals.prd.hash, hashText(edited));
  assert.equal(s.approvals.prd.source, 'mod');
  assert.ok(s.log.some((l: { event: string }) => l.event === 'PRD edits accepted with the plan'));
  assert.ok(!statusOf(wt).warnings.some((w) => /prd\.md changed/.test(w)), 'the warning clears');
});

test('with no PRD edit, the plan stop has no PRD note and plan approval leaves the PRD approval alone', () => {
  const wt = atPlanStop();
  const prdBefore = stateOf(wt).approvals.prd;
  assert.doesNotMatch(statusOf(wt).ready!.summary, PRD_NOTE);
  asUser(() => run(['approve', 'plan'], wt));
  const s = stateOf(wt);
  assert.deepEqual(s.approvals.prd, prdBefore);
  assert.ok(!s.log.some((l: { event: string }) => l.event === 'PRD edits accepted with the plan'));
});
