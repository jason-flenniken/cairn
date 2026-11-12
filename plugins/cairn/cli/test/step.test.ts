import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { run } from '../src/main.ts';
import { renderStatus, summary } from '../src/render.ts';
import { loadState, saveState } from '../src/state.ts';
import type { Stage } from '../src/types.ts';
import { Refusal } from '../src/util.ts';
import { pd } from './plandir.ts';

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const repos: string[] = [];
after(() => repos.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** A plan with the given stage written straight into its state. */
function plan(stage: Stage, track: 'feature' | 'fix' = 'feature') {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-step-')));
  repos.push(repo);
  g(repo, 'init', '-q', '-b', 'main');
  mkdirSync(join(repo, '.sdlc'));
  writeFileSync(join(repo, '.sdlc/config.json'), JSON.stringify({ test: 'true', maxParallel: 3, autoCommit: false }));
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
  const wt = run(['new', 'demo', '--title', 'Demo', ...(track === 'fix' ? ['--track', 'fix'] : [])], repo).data!.worktree as string;
  const dir = pd(wt, 'demo');
  const s = loadState(dir);
  s.stage = stage;
  saveState(dir, s);
  return { wt, dir, state: () => loadState(dir), raw: () => readFileSync(join(dir, 'state.json'), 'utf8') };
}
const refused = (cwd: string, pattern: RegExp, ...argv: string[]) =>
  assert.throws(
    () => run(argv, cwd),
    (e: unknown) => {
      assert.ok(e instanceof Refusal, `expected a refusal, got ${e}`);
      assert.match(e.message, pattern);
      return true;
    },
  );

test('a step shows in status, STATUS.md and status --json, and advance clears it', () => {
  const p = plan('review');
  run(['step', 'reviewing'], p.wt);
  run(['step', 'fixing', '--count', '3'], p.wt);
  assert.deepEqual({ ...p.state().step, at: undefined }, { stage: 'review', name: 'fixing', count: 3, at: undefined });
  assert.match(run(['status'], p.wt).message, /Review · fixing 3 findings/);
  assert.match(summary(p.state()), /Review · fixing 3 findings/);
  assert.match(renderStatus(p.state()), /\*\*Where we are:\*\* Review · fixing 3 findings/);
  assert.equal((run(['status', '--json'], p.wt).data!.state as { step: { name: string } }).step.name, 'fixing');
  run(['step', 'rechecking'], p.wt);
  assert.match(run(['status'], p.wt).message, /Review · re-checking/);

  const s = p.state();
  s.evidence.review = { result: 'pass', at: 'x', blocking: 0 };
  saveState(p.dir, s);
  run(['advance'], p.wt);
  assert.equal(p.state().step, undefined);
  assert.doesNotMatch(run(['status'], p.wt).message, /re-checking/);
});

test('after Build the phase count is gone; during Build it stays', () => {
  const p = plan('execute');
  const s = p.state();
  s.phases = [{ id: 'a', name: 'A', status: 'done', tasks: [] }];
  saveState(p.dir, s);
  assert.match(summary(p.state()), /Build · 0\/0 tasks done/);
  s.stage = 'review';
  saveState(p.dir, s);
  assert.doesNotMatch(renderStatus(p.state()) + summary(p.state()), /all phases done|phase \d/);
  assert.match(summary(p.state()), /: Review$/);
  const q = plan('execute');
  const t = q.state();
  t.phases = [{ id: 'a', name: 'A', status: 'in_progress', tasks: [] }, { id: 'b', name: 'B', status: 'pending', tasks: [] }];
  saveState(q.dir, t);
  assert.match(summary(q.state()), /phase 1\/2 "A"/);
});

test('the other stages take their own steps; the fix track uses review and ship', () => {
  for (const [stage, name] of [['verify', 'scanning'], ['ship', 'opening-pr']] as const) {
    const p = plan(stage);
    run(['step', name], p.wt);
    assert.equal(p.state().step?.name, name);
  }
  assert.match(summary((() => { const p = plan('ship'); run(['step', 'approving'], p.wt); return p.state(); })()), /Ship · waiting on approval/);
  assert.equal((() => { const p = plan('prd'); run(['step', 'checking'], p.wt); return p.state().step?.name; })(), 'checking');
  const f = plan('review', 'fix');
  run(['step', 'reviewing'], f.wt);
  assert.equal(f.state().step?.name, 'reviewing');
  refused(plan('verify', 'fix').wt, /valid steps: testing, scanning, fixing/, 'step', 'merging');
});

test('prd approving is refused while approval would refuse the PRD, and taken once it would pass', () => {
  const p = plan('prd');
  refused(p.wt, /prd\.md is not ready to approve/, 'step', 'approving');
  writeFileSync(join(p.dir, 'prd.md'), '## Problem\np\n## Solution\ns\n## Requirements\n- **FR-01** a\n## Non-goals\n- n\n## Open questions\n- [ ] which way?\n');
  refused(p.wt, /1 open question/, 'step', 'approving');
  assert.equal(p.state().step, undefined);
  writeFileSync(join(p.dir, 'prd.md'), readFileSync(join(p.dir, 'prd.md'), 'utf8').replace('- [ ] which way?', '- [x] which way? (this way)'));
  run(['step', 'approving'], p.wt);
  assert.equal(p.state().step?.name, 'approving');
});

test('refusals list the valid steps and write nothing', () => {
  const p = plan('review');
  const before = p.raw();
  refused(p.wt, /not a step at review; valid steps: reviewing, fixing, rechecking, asking, clear/, 'step', 'merging');
  refused(p.wt, /whole number/, 'step', 'fixing', '--count', '-1');
  refused(p.wt, /whole number/, 'step', 'fixing', '--count', 'three');
  refused(p.wt, /usage/, 'step');
  assert.equal(p.raw(), before);
  refused(plan('learn').wt, /no steps at learn/, 'step', 'reviewing');
});

test('hostile step names are refused, not echoed, and not written', () => {
  const p = plan('review');
  const before = p.raw();
  for (const bad of ['x; rm -rf ~', 'fixing\n', 'rev\niewing', '\u001b[31mfixing', 'reviewing\u001b[0m', '../x', '']) {
    assert.throws(
      () => run(['step', bad], p.wt),
      (e: unknown) => {
        assert.ok(e instanceof Refusal);
        assert.doesNotMatch(e.message, /rm -rf|\u001b/);
        return true;
      },
    );
  }
  assert.equal(p.raw(), before);
});

test('status --all --json words the step on each plan row, for the current stage only', () => {
  const p = plan('review');
  const rowOf = () => (run(['status', '--all', '--json'], p.wt).data!.plans as { stepText?: string }[])[0]!;
  assert.equal(rowOf().stepText, undefined);
  run(['step', 'fixing', '--count', '3'], p.wt);
  assert.equal(rowOf().stepText, 'fixing 3 findings');
  run(['step', 'rechecking'], p.wt);
  assert.equal(rowOf().stepText, 're-checking');
});

test('asking is a step at every working stage, and clear drops it', () => {
  for (const stage of ['repro', 'discover', 'prd', 'plan', 'execute', 'verify', 'review', 'ship'] as const) {
    const p = plan(stage);
    run(['step', 'asking'], p.wt);
    assert.equal(p.state().step?.name, 'asking', stage);
    run(['step', 'clear'], p.wt);
    assert.equal(p.state().step, undefined, stage);
  }
  refused(plan('learn').wt, /there are no steps at learn/, 'step', 'asking');
});

test('status --all --json sets needsUser while a plan is asking or at its approval step', () => {
  const p = plan('execute');
  const rowOf = () => (run(['status', '--all', '--json'], p.wt).data!.plans as { needsUser?: boolean; stepText?: string }[])[0]!;
  assert.equal(rowOf().needsUser, false);
  run(['step', 'asking'], p.wt);
  assert.equal(rowOf().needsUser, true);
  assert.equal(rowOf().stepText, 'waiting for your answer');
  run(['step', 'clear'], p.wt);
  assert.equal(rowOf().needsUser, false);
  const q = plan('plan');
  const qRow = () => (run(['status', '--all', '--json'], q.wt).data!.plans as { needsUser?: boolean }[])[0]!;
  run(['step', 'drafting'], q.wt);
  assert.equal(qRow().needsUser, false);
  run(['step', 'approving'], q.wt);
  assert.equal(qRow().needsUser, true);
});

test('a PRD with step asking is not ready: approval waits until the question is answered', () => {
  const p = plan('prd');
  writeFileSync(join(p.dir, 'prd.md'), '## Problem\np\n## Solution\ns\n## Requirements\n- **FR-01** a\n## Non-goals\n- n\n## Open questions\n- [x] which way? (this way)\n');
  assert.equal((run(['status'], p.wt).data as { ready?: { kind: string } }).ready?.kind, 'prd');
  run(['step', 'asking'], p.wt);
  assert.equal((run(['status'], p.wt).data as { ready?: unknown }).ready, undefined);
  run(['step', 'checking'], p.wt);
  run(['step', 'clear'], p.wt);
  assert.equal((run(['status'], p.wt).data as { ready?: { kind: string } }).ready?.kind, 'prd');
});
