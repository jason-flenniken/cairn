import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { run } from '../src/main.ts';
import { gate } from '../src/shared.ts';
import { loadState, newState, saveState } from '../src/state.ts';
import { Refusal } from '../src/util.ts';
import { addOrigin, fakeGh } from './handsoff-helpers.ts';
import { pd } from './plandir.ts';

/** The hands-off flow: the PRD is the only approval, how-checks pass with --call, what-checks with --not-done, and the PR says so. */

let repo: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const write = (p: string, s: string) => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, s);
};
const commit = (cwd: string, msg: string) => {
  g(cwd, 'add', '-A');
  g(cwd, 'commit', '-q', '-m', msg);
};
const ok = (cwd: string, ...argv: string[]) => run(argv, cwd);
/** Assert a refusal whose message matches `pattern` and, when given, whose fixes match `fixes`. */
const refused = (cwd: string, pattern: RegExp, argv: string[], fixes?: RegExp) =>
  assert.throws(
    () => run(argv, cwd),
    (e: unknown) => {
      assert.ok(e instanceof Refusal, `expected a refusal, got ${e}`);
      assert.match(e.message, pattern);
      if (fixes) assert.match(e.fixes.join('\n'), fixes);
      return true;
    },
  );
/** Act as the user through the mod: write the hash of a fresh mod secret and pass the secret in CAIRN_APPROVER. */
function byUser(cwd: string, ...argv: string[]) {
  const secret = randomBytes(16).toString('hex');
  mkdirSync(join(repo, '.git/cairn'), { recursive: true });
  writeFileSync(join(repo, '.git/cairn', `approver-${createHash('sha256').update(secret).digest('hex')}`), '1', { mode: 0o600 });
  process.env.CAIRN_APPROVER = secret;
  try {
    return run(argv, cwd);
  } finally {
    delete process.env.CAIRN_APPROVER;
  }
}

const stateOf = (wt: string, slug: string) => loadState(pd(wt, slug));
/** The suite is red while this file exists. */
const RED = () => join(repo, '.claude/worktrees/red-flag');
const goRed = () => write(RED(), 'x\n');
const goGreen = () => rmSync(RED(), { force: true });

const prd = (n = 1) =>
  `# PRD\n## Problem\np\n## Solution\ns\n## Requirements\n${Array.from({ length: n }, (_, i) => `- **FR-0${i + 1}** thing ${i + 1}. Check: works\n`).join('')}## Non-goals\n- x\n## Open questions\n- [x] none\n`;
/** One phase of independent tasks t1..tn, or the given yaml. */
const plan = (yaml: string) => `## Goal\ng\n## Architecture\na\n## Phases\n\`\`\`yaml cairn-tasks\n${yaml}\`\`\`\n`;
const flat = (n: number) =>
  plan(`phases:\n  - id: core\n    name: Core\n    tasks:\n${Array.from({ length: n }, (_, i) => `      - { id: t${i + 1}, name: T${i + 1}, covers: [FR-0${i + 1}], scope: ["src/t${i + 1}/**"] }\n`).join('')}`);
const RECORD = '## Links\nprd\n## Why\nw\n## What was built\nb\n## How it works\nh\n## Findings\nNone.\n## Follow-ups\nnone\n';

/** A feature plan taken from `new` through the PRD approval and the advance into the build, with no further approval. */
function toBuild(slug: string, opts: { tasks?: number; yaml?: string; extra?: string[]; reqs?: number } = {}): { wt: string; dir: string } {
  const wt = ok(repo, 'new', slug, '--level', 'standard', '--title', slug, ...(opts.extra ?? ['--no-proofs'])).data!.worktree as string;
  const dir = pd(wt, slug);
  ok(wt, 'decide', 'Which way?', 'This way', '--why', 'w');
  ok(wt, 'advance');
  write(join(dir, 'prd.md'), prd(opts.reqs ?? opts.tasks ?? 1));
  byUser(wt, 'approve', 'prd');
  ok(wt, 'advance');
  write(join(dir, 'plan.md'), opts.yaml ?? flat(opts.tasks ?? 1));
  ok(wt, 'plan', 'load');
  ok(wt, 'advance');
  return { wt, dir };
}

/** Build task `id` in its own worktree, merge it into the plan branch, and mark it done (with extra flags on `task done`). */
function build(wt: string, slug: string, id: string, ...flags: string[]) {
  const twt = ok(wt, 'task', 'start', id).data!.worktree as string;
  write(join(twt, `src/${id}/a.ts`), `export const x = '${id}';\n`);
  commit(twt, id);
  g(wt, 'merge', '-q', '--no-ff', '-m', `merge ${id}`, `task/${slug}/${id}`);
  return ok(wt, 'task', 'done', id, ...flags);
}

/** A one-task plan taken all the way to ship with everything green: tests, check, review, and a record. */
function toShip(slug: string, assumed?: string): { wt: string; dir: string } {
  const { wt, dir } = toBuild(slug);
  if (assumed) ok(wt, 'decide', `Assumed: ${assumed}`, 'yes');
  build(wt, slug, 't1');
  if (stateOf(wt, slug).stage === 'execute') ok(wt, 'phase', 'finish');
  ok(wt, 'test');
  ok(wt, 'evidence', 'verify', 'pass', '--note', 'ok');
  ok(wt, 'advance');
  ok(wt, 'evidence', 'review', 'pass', '--blocking', '0');
  ok(wt, 'advance');
  write(join(dir, 'RECORD.md'), RECORD);
  return { wt, dir };
}

before(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-handsoff-')));
  g(repo, 'init', '-q', '-b', 'main');
  write(join(repo, 'README.md'), 'hi\n');
  write(join(repo, '.gitignore'), '.claude/\n');
  write(join(repo, '.cairn/config.json'), JSON.stringify({ test: 'test ! -f ../red-flag', maxParallel: 3 }));
  commit(repo, 'init');
  addOrigin(repo);
});
after(() => rmSync(repo, { recursive: true, force: true }));

test('a feature plan goes from the PRD approval into the build with no further approval, and the proofs are locked at the advance', () => {
  const slug = 'flow';
  const wt = ok(repo, 'new', slug, '--level', 'standard', '--title', slug, '--proofs').data!.worktree as string;
  const dir = pd(wt, slug);
  ok(wt, 'decide', 'Which way?', 'This way', '--why', 'w');
  ok(wt, 'advance');
  write(join(dir, 'prd.md'), prd());
  byUser(wt, 'approve', 'prd');
  ok(wt, 'advance');
  assert.equal(stateOf(wt, slug).stage, 'plan');

  write(join(dir, 'plan.md'), flat(1));
  write(join(dir, 'proofs.md'), '# Proofs\n```yaml cairn-proofs\nproofs:\n  - id: one\n    covers: [FR-01]\n    run: sh proofs/one.sh\n    files: [proofs/one.sh]\n```\n');
  write(join(wt, 'proofs/one.sh'), 'test -f src/t1/a.ts\n');
  commit(wt, 'proofs');
  ok(wt, 'plan', 'load');
  assert.match(ok(wt, 'prove').message, /0 of 1 pass/, 'the proof is seen failing');
  assert.equal(stateOf(wt, slug).approvals.plan, undefined, 'nothing is approved before the advance');
  assert.equal(ok(repo, 'status', '--all').data!.plans && (ok(repo, 'status', '--all').data!.plans as { ready?: unknown }[])[0].ready, undefined, 'no stop is offered to the user');
  assert.ok(stateOf(wt, slug).endProofs!.list.every((p) => !p.lock));

  ok(wt, 'advance');
  const s = stateOf(wt, slug);
  assert.equal(s.stage, 'execute');
  assert.equal(s.approvals.plan?.via, 'agent');
  assert.ok(s.endProofs!.list.every((p) => p.lock), 'every proof is locked at the advance');
  assert.ok(s.log.some((l) => l.event === 'plan locked'));

  // A locked proof is part of the goal: it is never retired (10).
  write(join(wt, 'proofs/two.sh'), 'true\n');
  commit(wt, 'a corrected proof');
  ok(wt, 'prove', 'add', 'two', '--covers', 'FR-01', '--run', 'sh proofs/two.sh', '--files', 'proofs/two.sh', '--note', 'one is too strict');
  ok(wt, 'prove');
  refused(wt, /does not retire it/, ['prove', 'retire', 'one', '--replaced-by', 'two', '--override', 'one is too strict'], /--not-done/);
  assert.equal(stateOf(wt, slug).endProofs!.list.find((p) => p.id === 'one')!.retired, undefined);
});

test('a how check passes with --call and lands in calls; without the flag it refuses; before the PRD approval the flag passes nothing', () => {
  // The gate itself: the same flag is no way past a check until the goal is set.
  const bare = newState('g', 'G', 'feature', 'feature/g', 'main');
  assert.throws(() => gate(false, bare, 'x', { call: 'because' }, 'a how check', [], 'how'), (e: unknown) => e instanceof Refusal && /a how check/.test(e.message));
  assert.equal(bare.calls, undefined);
  bare.approvals.prd = { at: 'now', via: 'human' };
  gate(false, bare, 'x', { call: 'because' }, 'a how check', [], 'how');
  assert.equal((bare as { calls?: unknown[] }).calls?.length, 1);
  assert.throws(() => gate(false, bare, 'x', { 'not-done': 'because' }, 'a how check', [], 'how'), Refusal, 'a how check does not take --not-done');
  assert.throws(() => gate(false, bare, 'x', { call: '  ' }, 'a how check', [], 'how'), Refusal, 'an empty reason is no reason');

  // In a run: a fix that changes more files than a fix may.
  const wt = ok(repo, 'new', 'wide', '--track', 'fix', '--title', 'Wide').data!.worktree as string;
  write(join(repo, 'bug.txt'), 'broken\n');
  ok(wt, 'repro', 'grep -q fixed bug.txt; test $? -ne 0 && grep -q broken bug.txt || true; exit 1');
  ok(wt, 'advance');
  const swt = ok(wt, 'task', 'start', 'fix').data!.worktree as string;
  for (let i = 1; i <= 9; i++) write(join(swt, `src/f${i}.ts`), `${i}\n`);
  commit(swt, 'wide fix');
  g(wt, 'merge', '-q', '--no-ff', '-m', 'merge fix', 'task/wide/fix');
  // The repro is `exit 1`, so the fix also trips the repro check; the file limit is the how check under test.
  refused(wt, /changed 9 files/, ['task', 'done', 'fix', '--not-done', 'x'], /--call/);
  assert.equal(stateOf(wt, 'wide').calls, undefined);
});

test('a what check refuses without --not-done, passes with it, and the PR is a draft that lists it', () => {
  const { wt } = toBuild('red');
  build(wt, 'red', 't1');
  assert.equal(stateOf(wt, 'red').stage, 'verify');
  goRed();
  try {
    assert.match(ok(wt, 'test').message, /RED/);
    refused(wt, /full suite has not passed/, ['evidence', 'verify', 'pass', '--note', 'ok'], /--not-done/);
    refused(wt, /full suite has not passed/, ['evidence', 'verify', 'pass', '--note', 'ok', '--call', 'a call does not pass a what check']);
    assert.equal(stateOf(wt, 'red').evidence.verify, undefined);
    ok(wt, 'evidence', 'verify', 'pass', '--note', 'ok', '--not-done', 'the suite fails on a flag file; tried removing it; propose fixing the flag');
  } finally {
    goGreen();
  }
  const s = stateOf(wt, 'red');
  assert.equal(s.evidence.verify?.result, 'pass');
  assert.equal(s.notDone!.length, 1);
  assert.match(s.notDone![0].what, /full suite has not passed/);
  assert.match(s.notDone![0].why, /propose fixing the flag/);
  assert.ok(s.log.some((l) => l.event === 'not done: evidence verify'));
  const body = ok(wt, 'pr', 'body');
  assert.equal(body.data!.draft, true);
  assert.match(body.message, /## Not done \(\d+\)[\s\S]*full suite has not passed[\s\S]*propose fixing the flag/);
  assert.match(body.message, /draft because something above is not done/);
});

test('pr not-done records a miss no check covers, and the PR lists it', () => {
  const { wt } = toBuild('miss');
  assert.throws(() => run(['pr', 'not-done', 'FR-01 is unmet'], wt), /usage: cairn pr not-done/);
  ok(wt, 'pr', 'not-done', 'FR-01 is unmet', '--why', 'the checker found no path:line; tried a rewrite; propose a follow-up');
  assert.equal(stateOf(wt, 'miss').notDone![0].event, 'reported');
  assert.equal(ok(wt, 'pr', 'body').data!.draft, true);
});

test('--override is refused everywhere it used to work, naming --call and --not-done', () => {
  const { wt } = toBuild('ovr');
  const fixes = /--call[\s\S]*--not-done/;
  refused(wt, /--override was removed/, ['advance', '--override', 'x'], fixes);
  ok(wt, 'task', 'start', 't1');
  refused(wt, /--override was removed/, ['task', 'done', 't1', '--override', 'x'], fixes);
  refused(wt, /--override was removed/, ['evidence', 'verify', 'pass', '--override', 'x'], fixes);
  refused(wt, /--override was removed/, ['close', '--override', 'x'], fixes);
  const fresh = ok(repo, 'new', 'ovr2', '--level', 'standard', '--no-proofs').data!.worktree as string;
  refused(fresh, /--override was removed/, ['advance', '--override', 'skip the interview'], fixes);
  assert.equal(stateOf(fresh, 'ovr2').stage, 'discover');
});

test('approve plan, ship and commands are refused; approve prd works again later only when prd.md changed', () => {
  const { wt, dir } = toBuild('appr');
  for (const [kind, text] of [['plan', /the plan needs no approval/], ['ship', /the ship needs no approval/], ['commands', /need no approval/]] as const) {
    refused(wt, text, ['approve', kind]);
    assert.throws(() => byUser(wt, 'approve', kind), (e: unknown) => e instanceof Refusal && text.test(e.message), `${kind} by the user`);
  }
  assert.equal(stateOf(wt, 'appr').approvals.ship, undefined);
  assert.equal(stateOf(wt, 'appr').stage, 'execute');

  assert.throws(() => byUser(wt, 'approve', 'prd'), (e: unknown) => e instanceof Refusal && /has not changed since it was approved/.test(e.message));
  const before = stateOf(wt, 'appr').approvals.prd!.hash;
  write(join(dir, 'prd.md'), `${prd()}\nA changed requirement.\n`);
  assert.equal((ok(wt, 'status').data!.ready as { kind: string }).kind, 'prd', 'the edit is offered for approval at the build stage');
  byUser(wt, 'approve', 'prd');
  assert.notEqual(stateOf(wt, 'appr').approvals.prd!.hash, before);
  assert.equal(stateOf(wt, 'appr').stage, 'execute', 'the stage did not move');
  assert.equal(ok(wt, 'status').data!.ready, undefined);
});

test('a set-aside task does not stop phase finish; later phases open; what waits behind it is left out; the PR lists both', () => {
  const yaml = plan(`phases:
  - id: one
    name: One
    tasks:
      - { id: t1, name: T1, covers: [FR-01], scope: ["src/t1/**"] }
      - { id: t2, name: T2, covers: [FR-02], scope: ["src/t2/**"] }
  - id: two
    name: Two
    tasks:
      - { id: t3, name: T3, covers: [FR-03], scope: ["src/t3/**"] }
      - { id: t4, name: T4, covers: [FR-03], scope: ["src/t4/**"], blocked_by: [t2] }
`);
  const { wt } = toBuild('aside', { yaml, reqs: 3 });
  build(wt, 'aside', 't1');
  ok(wt, 'task', 'start', 't2');
  refused(wt, /unfinished tasks: T2/, ['phase', 'finish']);
  ok(wt, 'task', 'step', 't2', 'blocked', '--note', 'set aside: the API it needs is not there; tried a stub; propose a follow-up');
  assert.deepEqual((ok(wt, 'ready').data!.ready as { id: string }[]).map((t) => t.id), [], 'the next phase is not open until this one finishes');
  ok(wt, 'phase', 'finish');
  assert.equal(stateOf(wt, 'aside').phases[0].status, 'done');
  assert.deepEqual((ok(wt, 'ready').data!.ready as { id: string }[]).map((t) => t.id), ['t3'], 't4 waits behind the set-aside task and is not offered');

  const body = ok(wt, 'pr', 'body');
  assert.equal(body.data!.draft, true);
  const notDone = body.data!.notDone as string[];
  assert.ok(notDone.some((l) => /Task "T2" was set aside: set aside: the API it needs is not there/.test(l)), notDone.join('\n'));
  assert.ok(notDone.some((l) => /Task "T4" was not started: it waits on a task that was set aside/.test(l)), notDone.join('\n'));
});

test('changing the test command mid-build refuses nothing and is recorded as a call; changing only testQuick records none', () => {
  const { wt } = toBuild('cmds');
  const cfgFile = join(wt, '.cairn/config.json');
  const base = JSON.parse(readFileSync(join(repo, '.cairn/config.json'), 'utf8'));
  const touch = () => ok(wt, 'step', stateOf(wt, 'cmds').step ? 'clear' : 'wrapping');
  touch();
  assert.equal(stateOf(wt, 'cmds').calls, undefined);

  write(cfgFile, JSON.stringify({ ...base, testQuick: 'test ! -f ../red-flag' }));
  touch();
  assert.equal(stateOf(wt, 'cmds').calls, undefined, 'testQuick is not a command the run is held to');

  write(cfgFile, JSON.stringify({ ...base, test: 'true' }));
  touch();
  const calls = stateOf(wt, 'cmds').calls!;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].event, 'commands');
  assert.match(calls[0].what, /test: `test ! -f \.\.\/red-flag` → `true`/);
  touch();
  assert.equal(stateOf(wt, 'cmds').calls!.length, 1, 'recorded once');
  assert.match(ok(wt, 'pr', 'body').message, /## Calls made for you \(1\)[\s\S]*the commands cairn runs changed/);
  // The next task still starts and finishes: nothing refuses.
  ok(wt, 'task', 'start', 't1');
});

test('pr body on an all-green plan is ready, lists what was done, and lists assumed decisions as calls', () => {
  const { wt } = toShip('green', 'the export is a CSV');
  const body = ok(wt, 'pr', 'body');
  assert.equal(body.data!.draft, false);
  assert.deepEqual(body.data!.notDone, []);
  assert.deepEqual(body.data!.done, ['Tasks: 1 of 1 merged', 'Full test suite: green on this commit', 'Review: passed, nothing blocking']);
  assert.deepEqual(body.data!.calls, ['Assumed: the export is a CSV → yes']);
  assert.match(body.message, /## Done\n- Tasks: 1 of 1 merged/);
  assert.match(body.message, /## Calls made for you \(1\)\n- Assumed: the export is a CSV → yes/);
  assert.match(body.message, /## Not done \(0\)\n- None/);
  assert.match(body.message, /Everything the PRD asked for is done and green/);
  assert.match(body.message, /^b$/m, 'the record\'s "What was built" leads the body');
});

test('pr open pushes, creates the pull request through gh, and advance from ship waits for it', () => {
  const { wt } = toShip('open1');
  const gh = fakeGh();
  try {
    refused(wt, /the pull request is not open/, ['advance'], /cairn pr open/);
    refused(wt, /the pull request is not open/, ['merge-check']);
    const r = ok(wt, 'pr', 'open');
    assert.match(r.message, /Pull request opened \(ready to merge\): https:\/\/example\.test\/pull\/7/);
    const s = stateOf(wt, 'open1');
    assert.equal(s.pullRequest!.url, 'https://example.test/pull/7');
    assert.equal(s.pullRequest!.draft, false);
    assert.equal(s.pullRequest!.head, g(repo, 'ls-remote', '--heads', 'origin', 'feature/open1').split('\t')[0], 'the head recorded is the one pushed');
    const created = readFileSync(gh.log, 'utf8').split('\n').filter((l) => l.startsWith('pr create'));
    assert.equal(created.length, 1);
    assert.doesNotMatch(created[0], /--draft/);
    assert.match(g(repo, 'ls-remote', '--heads', 'origin', 'feature/open1'), /refs\/heads\/feature\/open1/);
    assert.ok(s.log.some((l) => l.event === 'pull request opened'));
    ok(wt, 'advance');
    assert.equal(stateOf(wt, 'open1').stage, 'learn');
  } finally {
    gh.restore();
  }
});

test('pr open creates a draft exactly when something is not done, and updating flips it to ready once nothing is', () => {
  const { wt } = toShip('open2');
  ok(wt, 'pr', 'not-done', 'FR-01 is only half there', '--why', 'the checker found no path:line; propose a follow-up');
  const gh = fakeGh();
  try {
    const r = ok(wt, 'pr', 'open');
    assert.match(r.message, /opened \(a draft: 1 not done\)/);
    const created = readFileSync(gh.log, 'utf8').split('\n').filter((l) => l.startsWith('pr create'));
    assert.match(created[0], /--draft/);
    assert.equal(stateOf(wt, 'open2').pullRequest!.draft, true);
    assert.match(created[0], /FR-01 is only half there/, 'the body lists it');

    // Sent back and fixed: nothing is left, the open pull request is updated and marked ready.
    const s = stateOf(wt, 'open2');
    s.notDone = [];
    saveState(pd(wt, 'open2'), s);
    process.env.FAKE_PR_VIEW = 'https://example.test/pull/7 true OPEN';
    const again = ok(wt, 'pr', 'open');
    assert.match(again.message, /updated \(ready to merge\)/);
    const log = readFileSync(gh.log, 'utf8').split('\n');
    assert.ok(log.some((l) => l.startsWith('pr edit')));
    assert.ok(log.some((l) => /^pr ready/.test(l) && !/--undo/.test(l)), log.join('\n'));
    assert.equal(stateOf(wt, 'open2').pullRequest!.draft, false);
    assert.ok(stateOf(wt, 'open2').log.some((l) => l.event === 'pull request updated'));
  } finally {
    delete process.env.FAKE_PR_VIEW;
    gh.restore();
  }
});

test('pr open refuses before ship, without a record, and when gh fails to create', () => {
  const { wt, dir } = toBuild('open3');
  refused(wt, /opens at ship; the plan is in execute/, ['pr', 'open']);
  const ship = toShip('open4');
  rmSync(join(ship.dir, 'RECORD.md'));
  refused(ship.wt, /RECORD\.md does not exist/, ['pr', 'open'], /record/);
  assert.equal(stateOf(ship.wt, 'open4').pullRequest, undefined);
  assert.ok(existsSync(dir));
});
