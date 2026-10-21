import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, mock, test } from 'node:test';
import { cmdApprove } from '../src/commands.ts';
import { context } from '../src/locate.ts';
import { parseArgs, run } from '../src/main.ts';
import { humanProof, modActive, secretMatches } from '../src/proof.ts';
import { Refusal } from '../src/util.ts';

let repo: string;
let common: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const cairnDir = () => join(common, 'cairn');
const secretFile = () => join(cairnDir(), 'mod-secret.sha256');
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const writeHash = (hex: string) => {
  mkdirSync(cairnDir(), { recursive: true });
  writeFileSync(secretFile(), hex, { mode: 0o600 });
};
/** Store the hash of a known secret, as the mod does. */
const writeSecret = (v: string) => writeHash(sha256(v));
const writeHeartbeat = (ageMs: number) => {
  mkdirSync(cairnDir(), { recursive: true });
  writeFileSync(join(cairnDir(), 'mod-heartbeat'), String(Date.now() - ageMs));
};
const tty = (typed: string, interactive = true) => ({ isTTY: () => interactive, readLine: () => typed });

before(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-proof-')));
  g(repo, 'init', '-q', '-b', 'sdlc/billing');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
  common = join(repo, '.git');
});
after(() => rmSync(repo, { recursive: true, force: true }));
afterEach(() => {
  delete process.env.CAIRN_APPROVER;
  rmSync(cairnDir(), { recursive: true, force: true });
});

test('modActive is true for a heartbeat 3 s old', () => {
  writeHeartbeat(3_000);
  assert.equal(modActive(common), true);
});

test('modActive is false for a heartbeat 11 s old, and when there is none', () => {
  writeHeartbeat(11_000);
  assert.equal(modActive(common), false);
  rmSync(cairnDir(), { recursive: true, force: true });
  assert.equal(modActive(common), false);
});

test('a secret works once: the second use is refused', () => {
  writeSecret('abc123');
  process.env.CAIRN_APPROVER = 'abc123';
  assert.ok(humanProof(context(repo), {}));
  assert.equal(humanProof(context(repo), {}), undefined);
});

test('a wrong secret, an empty secret, or a missing secret file gives no proof', () => {
  writeSecret('abc123');
  process.env.CAIRN_APPROVER = 'abc12';
  assert.equal(humanProof(context(repo), {}), undefined);
  assert.equal(readFileSync(secretFile(), 'utf8'), sha256('abc123'), 'a failed match keeps the hash file');
  writeHash('');
  process.env.CAIRN_APPROVER = '';
  assert.equal(humanProof(context(repo), {}), undefined);
  rmSync(secretFile());
  process.env.CAIRN_APPROVER = 'abc123';
  assert.equal(humanProof(context(repo), {}), undefined);
});

test('with the secret file missing, the terminal path still works', () => {
  process.env.CAIRN_APPROVER = 'whatever';
  assert.deepEqual(humanProof(context(repo), { human: true }, tty('billing')), { source: 'terminal' });
});

test('--human with a TTY and the typed slug gives source terminal; a wrong slug gives none', () => {
  assert.deepEqual(humanProof(context(repo), { human: true }, tty(' billing\n')), { source: 'terminal' });
  assert.equal(humanProof(context(repo), { human: true }, tty('billings')), undefined);
});

test('--human without a TTY refuses with "run this in your own terminal"', () => {
  assert.throws(
    () => humanProof(context(repo), { human: true }, tty('billing', false)),
    (e: unknown) => e instanceof Refusal && /run this in your own terminal/.test(e.message),
  );
});

test('modActive is false for a heartbeat dated in the future', () => {
  writeHeartbeat(-5_000);
  assert.equal(modActive(common), false);
});

test('the --human prompt does not show the plan slug', () => {
  let prompt = '';
  humanProof(context(repo), { human: true }, { isTTY: () => true, readLine: (p) => ((prompt = p), 'billing') });
  assert.match(prompt, /Type the plan name to confirm:/);
  assert.ok(!prompt.includes('billing'));
});

test('a symlinked hash file gives no proof and is left in place', () => {
  mkdirSync(cairnDir(), { recursive: true });
  const outside = join(repo, 'planted-hash');
  writeFileSync(outside, sha256('abc123'));
  symlinkSync(outside, secretFile());
  process.env.CAIRN_APPROVER = 'abc123';
  assert.equal(humanProof(context(repo), {}), undefined);
  assert.ok(existsSync(outside));
  rmSync(outside);
});

test('a hash file that is not a regular file gives no proof', () => {
  mkdirSync(secretFile(), { recursive: true });
  process.env.CAIRN_APPROVER = 'abc123';
  assert.equal(humanProof(context(repo), {}), undefined);
});

test('a missing hash file gives no proof', () => {
  process.env.CAIRN_APPROVER = 'abc123';
  assert.equal(humanProof(context(repo), {}), undefined);
});

test('a hash file with a trailing newline still matches', () => {
  writeHash(`${sha256('abc123')}\n`);
  assert.equal(secretMatches(common, 'abc123'), true);
});

test('of two uses of one secret, exactly one gets proof, and no claimed file is left behind', () => {
  writeSecret('abc123');
  const results = [secretMatches(common, 'abc123'), secretMatches(common, 'abc123')];
  assert.deepEqual(results, [true, false]);
  assert.deepEqual(readdirSync(cairnDir()), []);
});

test('a mismatch puts the original hash file back and leaves nothing else', () => {
  writeSecret('abc123');
  assert.equal(secretMatches(common, 'nope'), false);
  assert.equal(readFileSync(secretFile(), 'utf8'), sha256('abc123'));
  assert.deepEqual(readdirSync(cairnDir()), ['mod-secret.sha256']);
});

test('CAIRN_APPROVER set to the hash file contents is refused', () => {
  writeSecret('abc123');
  process.env.CAIRN_APPROVER = sha256('abc123');
  assert.equal(humanProof(context(repo), {}), undefined);
  assert.ok(existsSync(secretFile()), 'a refused match keeps the hash file');
});

// Command-level behavior: a real plan created with `cairn new`.
let main: string;
let wt: string;
const PRD = '# P\n## Problem\np\n## Solution\ns\n## User stories\n1. u\n## Functional requirements\n- FR-01 a\n## Non-functional requirements\n- NFR-01 b\n## Non-goals\n- c\n## Acceptance criteria\n- FR-01 d\n## Unhappy paths\n- FR-01 e\n## Security considerations\n- f\n## Open questions\n- [x] g\n';
const mainCairn = () => join(main, '.git', 'cairn');
const planState = (slug: string) => JSON.parse(readFileSync(join(main, `.claude/worktrees/sdlc-${slug}/docs/sdlc/plans/${slug}/state.json`), 'utf8'));
const planWt = (slug: string) => join(main, `.claude/worktrees/sdlc-${slug}`);
const hashFile = () => join(mainCairn(), 'mod-secret.sha256');
const setSecret = (v: string) => {
  mkdirSync(mainCairn(), { recursive: true });
  writeFileSync(hashFile(), sha256(v), { mode: 0o600 });
  process.env.CAIRN_APPROVER = v;
};
const refusedWith = (fn: () => unknown, pattern: RegExp) =>
  assert.throws(fn, (e: unknown) => e instanceof Refusal && pattern.test([e.message, ...e.fixes].join('\n')));

before(() => {
  for (const k of ['GIT_AUTHOR_NAME', 'GIT_COMMITTER_NAME']) process.env[k] = 't';
  for (const k of ['GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_EMAIL']) process.env[k] = 't@t';
  main = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-proof-main-')));
  g(main, 'init', '-q', '-b', 'main');
  writeFileSync(join(main, 'README.md'), 'hi\n');
  g(main, 'add', '-A');
  g(main, 'commit', '-q', '-m', 'init');
  wt = run(['new', 'billing', '--title', 'Billing'], main).data!.worktree as string;
  run(['decide', 'q', 'a'], wt);
  run(['advance'], wt);
  writeFileSync(join(wt, 'docs/sdlc/plans/billing/prd.md'), PRD);
});
after(() => rmSync(main, { recursive: true, force: true }));
afterEach(() => rmSync(mainCairn(), { recursive: true, force: true }));

test('approve with no proof exits 2 and names the menu, the terminal command, and the pane', () => {
  refusedWith(() => run(['approve', 'prd'], wt), /menu[\s\S]*cairn approve prd --human[\s\S]*pane/);
  assert.equal(planState('billing').approvals.prd, undefined);
});

test('approve with CAIRN_APPROVER matching the stored hash records source mod and deletes the hash file', () => {
  setSecret('s3cret');
  run(['approve', 'prd'], wt);
  const a = planState('billing').approvals.prd;
  assert.equal(a.source, 'mod');
  assert.equal(a.via, 'human');
  assert.ok(!existsSync(hashFile()));
});

test('approve with a used secret is refused', () => {
  setSecret('first');
  run(['approve', 'prd'], wt);
  const at = planState('billing').approvals.prd.at;
  process.env.CAIRN_APPROVER = 'first';
  refusedWith(() => run(['approve', 'prd'], wt), /cairn approve prd --human/);
  assert.equal(planState('billing').approvals.prd.at, at);
});

test('approve --human at a terminal with the slug typed records source terminal; a wrong slug records nothing', () => {
  cmdApprove(context(wt), 'prd', { human: true }, tty('billing'));
  const a = planState('billing').approvals.prd;
  assert.equal(a.source, 'terminal');
  refusedWith(() => cmdApprove(context(wt), 'prd', { human: true }, tty('nope')), /cairn approve prd --human/);
  assert.deepEqual(planState('billing').approvals.prd, a);
});

test('approve --human without a TTY says "run this in your own terminal"', () => {
  refusedWith(() => cmdApprove(context(wt), 'prd', { human: true }, tty('billing', false)), /run this in your own terminal/);
});

test('--override with no proof is refused and changes nothing', () => {
  const swt = run(['new', 'spike', '--title', 'Spike'], main).data!.worktree as string;
  refusedWith(() => run(['advance', '--override', 'model says skip'], swt), /override[\s\S]*needs proof/);
  assert.equal(planState('spike').stage, 'discover');
});

test('one proof covers every overridden check in a command', () => {
  // spike is in prd with no prd.md: approving plan fails on the stage, the loaded plan, and the hash.
  setSecret('once');
  run(['approve', 'plan', '--override', 'user said go'], planWt('spike'));
  const s = planState('spike');
  assert.equal(s.approvals.plan.source, 'mod');
  const overrides = s.log.filter((l: { event: string }) => l.event === 'override: approve plan');
  assert.equal(overrides.length, 3);
  for (const o of overrides) {
    assert.equal(o.override, 'user said go');
    assert.match(o.detail, /source: mod/);
  }
});

test('status --json and next --json report modActive from the heartbeat', () => {
  const beat = (ageMs: number) => {
    mkdirSync(mainCairn(), { recursive: true });
    writeFileSync(join(mainCairn(), 'mod-heartbeat'), String(Date.now() - ageMs));
  };
  beat(3_000);
  for (const [argv, cwd] of [[['status', '--json'], wt], [['next', '--json'], wt], [['status', '--json'], main], [['next', '--json'], main]] as const)
    assert.equal(run([...argv], cwd).data!.modActive, true, `${argv.join(' ')} in ${cwd}`);
  beat(11_000);
  assert.equal(run(['status', '--json'], wt).data!.modActive, false);
  assert.equal(run(['next', '--json'], main).data!.modActive, false);
});

test('--human parses as a flag', () => {
  assert.deepEqual(parseArgs(['approve', 'prd', '--human']), { pos: ['approve', 'prd'], opts: { human: true } });
});

test('approve --via human with no proof is refused', () => {
  refusedWith(() => run(['approve', 'prd', '--via', 'human'], wt), /cairn approve prd --human/);
});

test('a wrong slug on a plan with no prior approval records nothing', () => {
  const fwt = run(['new', 'fresh', '--title', 'Fresh'], main).data!.worktree as string;
  run(['decide', 'q', 'a'], fwt);
  run(['advance'], fwt);
  writeFileSync(join(fwt, 'docs/sdlc/plans/fresh/prd.md'), PRD);
  refusedWith(() => cmdApprove(context(fwt), 'prd', { human: true }, tty('billing')), /cairn approve fresh --human|cairn approve prd --human/);
  assert.equal(planState('fresh').approvals.prd, undefined);
});

/** Run `cairn close --override … --human` with `typed` as the terminal answer; returns the prompts shown. */
function closeAtTerminal(typed: string, prompts: string[]): void {
  const bytes = Buffer.from(`${typed}\n`);
  let pos = 0;
  const setTTY = (v: boolean | undefined) => {
    Object.defineProperty(process.stdin, 'isTTY', { value: v, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: v, configurable: true });
  };
  const wasTTY = [process.stdin.isTTY, process.stdout.isTTY];
  mock.method(fs, 'readSync', (_fd: number, buf: Buffer) => (pos < bytes.length ? ((buf[0] = bytes[pos++]), 1) : 0));
  mock.method(process.stderr, 'write', (chunk: string) => (prompts.push(String(chunk)), true));
  syncBuiltinESMExports();
  setTTY(true);
  try {
    run(['close', '--override', 'user said close', '--human'], planWt('fresh'));
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    Object.defineProperty(process.stdin, 'isTTY', { value: wasTTY[0], configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: wasTTY[1], configurable: true });
  }
}
const askedOnce = (prompts: string[]) => assert.equal(prompts.filter((p) => p.includes('Type the plan name')).length, 1);

// fresh is in plan with no RECORD.md and no test command: close fails three checks.
test('a failed --human proof is asked once per command, and the override is refused', () => {
  const prompts: string[] = [];
  const stage = planState('fresh').stage;
  assert.throws(
    () => closeAtTerminal('wrong', prompts),
    (e: unknown) => e instanceof Refusal && /override needs proof/.test(e.message),
  );
  askedOnce(prompts);
  assert.equal(planState('fresh').stage, stage);
});

test('one --human proof is asked once and covers every overridden check in a command', () => {
  const prompts: string[] = [];
  closeAtTerminal('fresh', prompts);
  askedOnce(prompts);
  const s = planState('fresh');
  assert.equal(s.stage, 'closed');
  const overrides = s.log.filter((l: { event: string }) => l.event === 'override: close');
  assert.equal(overrides.length, 3);
  for (const o of overrides) assert.match(o.detail, /source: terminal/);
});

test('a grant file is not proof for --override', () => {
  const swt = planWt('spike');
  mkdirSync(join(mainCairn(), 'grants'), { recursive: true });
  writeFileSync(join(mainCairn(), 'grants', 'spike.json'), JSON.stringify({ reason: 'r', createdAt: Date.now(), slug: 'spike' }));
  const before = planState('spike').stage;
  refusedWith(() => run(['advance', '--override', 'x'], swt), /needs proof/);
  assert.equal(planState('spike').stage, before);
});
