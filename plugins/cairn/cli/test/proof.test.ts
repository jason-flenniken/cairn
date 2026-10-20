import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { cmdApprove } from '../src/commands.ts';
import { context } from '../src/locate.ts';
import { parseArgs, run } from '../src/main.ts';
import { consumeGrant, humanProof, modActive, rotateSecret } from '../src/proof.ts';
import { Refusal } from '../src/util.ts';

let repo: string;
let common: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const cairnDir = () => join(common, 'cairn');
const secretFile = () => join(cairnDir(), 'mod-secret');
const readSecret = () => readFileSync(secretFile(), 'utf8');
const writeSecret = (v: string) => {
  mkdirSync(cairnDir(), { recursive: true });
  writeFileSync(secretFile(), v, { mode: 0o600 });
};
const writeHeartbeat = (ageMs: number) => {
  mkdirSync(cairnDir(), { recursive: true });
  writeFileSync(join(cairnDir(), 'mod-heartbeat'), String(Date.now() - ageMs));
};
const writeGrant = (slug: string, ageMs: number, body: Record<string, unknown> = {}) => {
  mkdirSync(join(cairnDir(), 'grants'), { recursive: true });
  writeFileSync(join(cairnDir(), 'grants', `${slug}.json`), JSON.stringify({ reason: 'Skip the interview? [cairn:override x]', createdAt: Date.now() - ageMs, slug, ...body }));
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

test('rotateSecret writes a new hex secret with mode 0600', () => {
  writeSecret('old');
  rotateSecret(common);
  const s = readSecret();
  assert.notEqual(s, 'old');
  assert.match(s, /^[0-9a-f]{64}$/);
  assert.equal(statSync(secretFile()).mode & 0o777, 0o600);
});

test('humanProof accepts the current secret as source mod and rotates it', () => {
  writeSecret('abc123');
  process.env.CAIRN_APPROVER = 'abc123';
  assert.deepEqual(humanProof(context(repo), {}), { source: 'mod' });
  assert.notEqual(readSecret(), 'abc123');
  assert.equal(statSync(secretFile()).mode & 0o777, 0o600);
});

test('a stale secret is refused after rotation', () => {
  writeSecret('abc123');
  process.env.CAIRN_APPROVER = 'abc123';
  assert.ok(humanProof(context(repo), {}));
  assert.equal(humanProof(context(repo), {}), undefined);
});

test('a wrong secret, an empty secret, or a missing secret file gives no proof', () => {
  writeSecret('abc123');
  process.env.CAIRN_APPROVER = 'abc12';
  assert.equal(humanProof(context(repo), {}), undefined);
  assert.equal(readSecret(), 'abc123', 'a failed match does not rotate');
  writeSecret('');
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

test('a grant is consumed once and then refused', () => {
  writeGrant('billing', 1_000);
  assert.deepEqual(consumeGrant(common, 'billing'), { reason: 'Skip the interview? [cairn:override x]' });
  assert.ok(!existsSync(join(cairnDir(), 'grants', 'billing.json')));
  assert.equal(consumeGrant(common, 'billing'), undefined);
});

test('a grant older than 10 minutes is refused and removed', () => {
  writeGrant('billing', 10 * 60_000 + 1_000);
  assert.equal(consumeGrant(common, 'billing'), undefined);
  assert.ok(!existsSync(join(cairnDir(), 'grants', 'billing.json')));
});

test('a grant dated in the future, for another slug, or with a bad slug is refused', () => {
  writeGrant('billing', -60_000);
  assert.equal(consumeGrant(common, 'billing'), undefined);
  writeGrant('billing', 1_000, { slug: 'other' });
  assert.equal(consumeGrant(common, 'billing'), undefined);
  assert.equal(consumeGrant(common, '../billing'), undefined);
});

// Command-level behavior: a real plan created with `cairn new`.
let main: string;
let wt: string;
const PRD = '# P\n## Problem\np\n## Solution\ns\n## User stories\n1. u\n## Functional requirements\n- FR-01 a\n## Non-functional requirements\n- NFR-01 b\n## Non-goals\n- c\n## Acceptance criteria\n- FR-01 d\n## Unhappy paths\n- FR-01 e\n## Security considerations\n- f\n## Open questions\n- [x] g\n';
const mainCairn = () => join(main, '.git', 'cairn');
const planState = (slug: string) => JSON.parse(readFileSync(join(main, `.claude/worktrees/sdlc-${slug}/docs/sdlc/plans/${slug}/state.json`), 'utf8'));
const planWt = (slug: string) => join(main, `.claude/worktrees/sdlc-${slug}`);
const setSecret = (v: string) => {
  mkdirSync(mainCairn(), { recursive: true });
  writeFileSync(join(mainCairn(), 'mod-secret'), v, { mode: 0o600 });
  process.env.CAIRN_APPROVER = v;
};
const grant = (slug: string, ageMs: number) => {
  mkdirSync(join(mainCairn(), 'grants'), { recursive: true });
  writeFileSync(join(mainCairn(), 'grants', `${slug}.json`), JSON.stringify({ reason: `Skip this check? [cairn:override ${slug}]`, createdAt: Date.now() - ageMs, slug }));
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

test('approve with CAIRN_APPROVER equal to the secret records source mod and rotates the secret', () => {
  setSecret('s3cret');
  run(['approve', 'prd'], wt);
  const a = planState('billing').approvals.prd;
  assert.equal(a.source, 'mod');
  assert.equal(a.via, 'human');
  assert.notEqual(readFileSync(join(mainCairn(), 'mod-secret'), 'utf8'), 's3cret');
});

test('approve with a stale secret is refused after the secret rotated', () => {
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

test('an override grant is not proof for approve', () => {
  grant('billing', 1_000);
  refusedWith(() => run(['approve', 'prd'], wt), /cairn approve prd --human/);
});

test('--override with no proof is refused and changes nothing', () => {
  const swt = run(['new', 'spike', '--title', 'Spike'], main).data!.worktree as string;
  refusedWith(() => run(['advance', '--override', 'model says skip'], swt), /override[\s\S]*\[cairn:override spike\]/);
  assert.equal(planState('spike').stage, 'discover');
});

test('a grant lets one --override through, records its reason and source, and is then refused', () => {
  grant('spike', 1_000);
  run(['advance', '--override', 'model text'], planWt('spike'));
  const s = planState('spike');
  assert.equal(s.stage, 'prd');
  const entry = s.log.find((l: { event: string }) => l.event === 'override: advance');
  assert.equal(entry.override, 'Skip this check? [cairn:override spike]');
  assert.match(entry.detail, /source: grant/);
  assert.ok(!existsSync(join(mainCairn(), 'grants', 'spike.json')));
  refusedWith(() => run(['advance', '--override', 'again'], planWt('spike')), /\[cairn:override spike\]/);
  assert.equal(planState('spike').stage, 'prd');
});

test('a grant older than 10 minutes does not let --override through', () => {
  grant('spike', 11 * 60_000);
  refusedWith(() => run(['advance', '--override', 'late'], planWt('spike')), /\[cairn:override spike\]/);
  assert.equal(planState('spike').stage, 'prd');
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
