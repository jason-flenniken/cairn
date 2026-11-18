import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { parseProofs } from '../src/endproofs.ts';
import { run } from '../src/main.ts';
import { Refusal } from '../src/util.ts';
import { pd } from './plandir.ts';

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
const refused = (cwd: string, pattern: RegExp, ...argv: string[]) =>
  assert.throws(() => run(argv, cwd), (e: unknown) => e instanceof Refusal && pattern.test(e.message));
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
const byUser = (cwd: string, ...argv: string[]) => asUser(() => ok(cwd, ...argv));
const refusedByUser = (cwd: string, pattern: RegExp, ...argv: string[]) => asUser(() => refused(cwd, pattern, ...argv));

const PRD = `# Shop PRD
## Problem
p
## Solution
s
## Requirements
- **FR-01** total. Check: total shown
- **FR-02** cart looks right. Check: cart screenshot matches
## Non-goals
- crypto
## Open questions
- [x] none
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
      - { id: total, name: Total, covers: [FR-01], scope: ["src/total*"] }
      - { id: cart, name: Cart, covers: [FR-02], scope: ["src/cart*"] }
\`\`\`
`;

const proofsMd = (withCart = true) => `# Proofs
\`\`\`yaml cairn-proofs
proofs:
  - id: total
    covers: [FR-01]
    run: sh proofs/total.sh
    files: [proofs/total.sh]
${withCart ? `  - id: cart
    covers: [FR-02]
    run: sh proofs/cart.sh
    files: [proofs/cart.sh]
    shots: [cart]
    look: the cart lists one item with its price
` : ''}\`\`\`
`;

before(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-proofs-')));
  g(repo, 'init', '-q', '-b', 'main');
  write(join(repo, 'README.md'), 'hi\n');
  write(join(repo, '.cairn/config.json'), JSON.stringify({ test: 'true', maxParallel: 3 }));
  commit(repo, 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

test('proofs: required before the build, seen red, locked at the advance, add-only, and green before check and ship', () => {
  const wt = ok(repo, 'new', 'shop', '--level', 'standard', '--title', 'Shop', '--proofs').data!.worktree as string;
  const dir = pd(wt, 'shop');
  const state = () => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  assert.equal(state().endProofs.required, true);
  ok(wt, 'decide', 'q', 'a');
  ok(wt, 'advance');
  write(join(dir, 'prd.md'), PRD);
  byUser(wt, 'approve', 'prd');
  ok(wt, 'advance');
  write(join(dir, 'plan.md'), PLAN);

  // No proofs, or proofs that leave a requirement uncovered, do not load.
  refused(wt, /proofs\.md does not exist/, 'plan', 'load');
  write(join(dir, 'proofs.md'), proofsMd(false));
  refused(wt, /file proofs\/total\.sh does not exist/, 'plan', 'load');
  write(join(wt, 'proofs/total.sh'), 'test -f src/total.txt\n');
  write(join(wt, 'proofs/cart.sh'), 'test -f src/cart.txt && cp src/cart.txt "$CAIRN_SHOTS/cart.png"\n');
  commit(wt, 'proofs');
  refused(wt, /no proof covers FR-02/, 'plan', 'load');
  write(join(dir, 'proofs.md'), proofsMd());
  ok(wt, 'plan', 'load');

  // A proof has to be seen failing before the build, or it proves nothing.
  refused(wt, /total has not been seen failing/, 'advance');
  write(join(wt, 'proofs/cart.sh'), 'test -f src/cart.txt && cp src/cart.txt "$CAIRN_SHOTS/cart.png" # edited\n');
  ok(wt, 'prove');
  refused(wt, /proof files are not committed on the plan branch: proofs\/cart\.sh/, 'advance');
  commit(wt, 'proof edit');
  const red = ok(wt, 'prove');
  assert.match(red.message, /0 of 2 pass/);
  assert.match(red.message, /total {2}FAIL/);
  // No stop for the user: the pane and the menu offer nothing, and the advance locks the proofs.
  const row = (ok(repo, 'status', '--all').data!.plans as { state: { slug: string }; ready?: { kind: string } }[]).find((r) => r.state.slug === 'shop');
  assert.equal(row?.ready, undefined, 'status --all offers nothing: the plan needs no approval');
  assert.ok(state().endProofs.list.every((p: { lock?: string }) => !p.lock), 'not locked before the advance');
  ok(wt, 'advance');
  assert.ok(state().endProofs.list.every((p: { lock?: string }) => p.lock), 'every proof is locked at the advance');
  assert.equal(state().approvals.plan.via, 'agent');

  // The build brief names the proofs the task answers for, read-only.
  const taskWt = ok(wt, 'task', 'start', 'total').data!.worktree as string;
  const brief = readFileSync(ok(wt, 'task', 'brief', 'total').data!.path as string, 'utf8');
  assert.match(brief, /## Proofs this task answers for/);
  assert.match(brief, /\*\*total\*\* \(FR-01\): `sh proofs\/total\.sh`/);
  assert.doesNotMatch(brief, /\*\*cart\*\*/);

  // Editing a locked proof file refuses the merge; restoring it lets the merge through.
  write(join(taskWt, 'src/total.txt'), '42\n');
  write(join(taskWt, 'proofs/total.sh'), 'true\n');
  commit(taskWt, 'total, and a weakened proof');
  const here = ok(taskWt, 'prove', '--here', '--task', 'total');
  assert.match(here.message, /not recorded/);
  refused(wt, /changes locked proof files: proofs\/total\.sh/, 'task', 'merge', 'total');
  g(taskWt, 'checkout', 'feature/shop', '--', 'proofs/total.sh');
  commit(taskWt, 'restore the proof');
  ok(wt, 'task', 'merge', 'total');

  const cartWt = ok(wt, 'task', 'start', 'cart').data!.worktree as string;
  write(join(cartWt, 'src/cart.txt'), 'png\n');
  commit(cartWt, 'cart');
  ok(wt, 'task', 'merge', 'cart');
  ok(wt, 'phase', 'finish');
  assert.equal(state().stage, 'verify', 'the last phase finishing moves the plan to check');

  // Check can't be left until every proof is green and the screenshots are judged.
  ok(wt, 'test');
  ok(wt, 'evidence', 'verify', 'pass', '--note', 'green');
  refused(wt, /proofs do not show the end state: total is red/, 'advance');
  assert.match(ok(wt, 'prove').message, /2 of 2 pass/);
  refused(wt, /cart is unjudged/, 'advance');
  ok(wt, 'prove', 'judge', 'cart', 'pass');
  ok(wt, 'advance');
  assert.equal(state().stage, 'review');

  // New code after a run makes the proofs stale.
  write(join(wt, 'src/other.txt'), 'x\n');
  commit(wt, 'more code');
  assert.match(ok(wt, 'prove', 'list').message, /total {2}stale: the code changed since it ran/);

  // Proofs are add-only: an existing id is refused, a new one is locked and listed.
  write(join(wt, 'proofs/empty-cart.sh'), 'true\n');
  commit(wt, 'extra proof');
  refused(wt, /proofs are add-only/, 'prove', 'add', 'total', '--covers', 'FR-01', '--run', 'true', '--files', 'proofs/empty-cart.sh');
  ok(wt, 'prove', 'add', 'empty-cart', '--covers', 'FR-02', '--run', 'sh proofs/empty-cart.sh', '--files', 'proofs/empty-cart.sh', '--note', 'an empty cart was unchecked');
  const added = state().endProofs.list.find((p: { id: string }) => p.id === 'empty-cart');
  assert.ok(added.lock && added.added);
  ok(wt, 'prove');
  ok(wt, 'prove', 'judge', 'cart', 'pass');
  assert.match(ok(wt, 'prove', 'list').message, /3 of 3 green/);
});

test('parseProofs: not provable needs a reason, deferred requirements need no proof, shots need a look', () => {
  const prd = PRD.replace('## Non-goals', '- **FR-03** docs read clearly. Check: a reader agrees\n- **FR-04** later. Check: x\n## Non-goals');
  const plan = `${PLAN}\n## Deferred requirements\n- FR-04: next plan\n`;
  const md = (extra: string) => `\`\`\`yaml cairn-proofs\nproofs:\n  - id: a\n    covers: [FR-01, FR-02]\n    run: "true"\n    files: [README.md]\n${extra}\`\`\`\n`;
  assert.deepEqual(parseProofs(md('') + '## Not provable\n- FR-03: wording is a judgment call\n', prd, plan, repo).problems, []);
  assert.match(parseProofs(md(''), prd, plan, repo).problems.join(), /no proof covers FR-03/);
  assert.match(parseProofs(md('') + '## Not provable\n- FR-03:\n', prd, plan, repo).problems.join(), /FR-03 is listed as not provable with no reason/);
  assert.match(parseProofs(md('    shots: [cart]\n'), prd, plan, repo).problems.join(), /needs `look`/);
  assert.match(parseProofs(md('    expect: fail\n'), prd, plan, repo).problems.join(), /`expect` can only be "pass"/);
  assert.match(parseProofs(md('').replace('README.md', '../etc/passwd'), prd, plan, repo).problems.join(), /must be a path inside the repo/);
});

test('proofs are chosen per plan at the start: --proofs or --no-proofs, never the repo default; any level may opt in', () => {
  const st = (wt: string, slug: string) => JSON.parse(readFileSync(join(pd(wt, slug), 'state.json'), 'utf8'));
  const mvp = ok(repo, 'new', 'tiny', '--level', 'mvp', '--proofs');
  assert.match(mvp.message, /Proofs: on/);
  assert.equal(mvp.data!.proofs, true);
  assert.equal(st(mvp.data!.worktree as string, 'tiny').endProofs.required, true, 'an MVP plan can opt in');
  const off = ok(repo, 'new', 'plain', '--level', 'standard', '--no-proofs');
  assert.equal(off.data!.proofs, false);
  assert.equal(st(off.data!.worktree as string, 'plain').endProofs, undefined);
  assert.throws(() => ok(repo, 'new', 'both', '--level', 'standard', '--proofs', '--no-proofs'), /not both/);
  assert.equal(ok(repo, 'new', 'fixit', '--track', 'fix', '--proofs').data!.proofs, null, 'a fix plan has no proofs: its repro is the proof');

  write(join(repo, '.cairn/config.json'), JSON.stringify({ test: 'true', maxParallel: 3, proofs: 'on' }));
  commit(repo, 'proofs on by default');
  assert.throws(() => ok(repo, 'new', 'dflt', '--level', 'standard'), /--proofs or --no-proofs/, 'the repo default no longer answers for the user');
  assert.equal(ok(repo, 'new', 'optout', '--level', 'standard', '--no-proofs').data!.proofs, false);
});

test('a locked proof that is itself wrong is never retired: a replacement stands beside it and the red one is passed with --not-done', () => {
  const wt = ok(repo, 'new', 'retire', '--level', 'standard', '--title', 'Retire', '--proofs').data!.worktree as string;
  const dir = pd(wt, 'retire');
  const state = () => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  ok(wt, 'decide', 'q', 'a');
  ok(wt, 'advance');
  write(join(dir, 'prd.md'), PRD);
  byUser(wt, 'approve', 'prd');
  ok(wt, 'advance');
  write(join(dir, 'plan.md'), PLAN.replace('{ id: cart, name: Cart, covers: [FR-02], scope: ["src/cart*"] }', '{ id: cart, name: Cart, covers: [FR-02], scope: ["src/cart*"] }'));
  write(join(dir, 'proofs.md'), `# Proofs
\`\`\`yaml cairn-proofs
proofs:
  - id: wrong
    covers: [FR-01, FR-02]
    run: sh proofs/wrong.sh
    files: [proofs/wrong.sh]
  - id: other
    covers: [FR-02]
    run: sh proofs/other.sh
    files: [proofs/other.sh]
\`\`\`
`);
  write(join(wt, 'proofs/wrong.sh'), 'test -f src/never.txt\n');
  write(join(wt, 'proofs/other.sh'), 'test -f src/cart.txt\n');
  commit(wt, 'proofs');
  ok(wt, 'plan', 'load');
  ok(wt, 'prove');
  ok(wt, 'advance');
  for (const t of ['total', 'cart']) {
    const tw = ok(wt, 'task', 'start', t).data!.worktree as string;
    write(join(tw, `src/${t}.txt`), 'x\n');
    commit(tw, t);
    ok(wt, 'task', 'merge', t);
  }
  ok(wt, 'phase', 'finish');
  assert.equal(state().stage, 'verify');
  ok(wt, 'test');
  ok(wt, 'evidence', 'verify', 'pass', '--note', 'green');
  refused(wt, /proofs do not show the end state: wrong is red/, 'advance');

  write(join(wt, 'proofs/fixed.sh'), 'test -f src/total.txt && test -f src/cart.txt\n');
  // The corrected proof is added beside it; the wrong one stays red and blocks the advance until it is passed as not done.
  commit(wt, 'a corrected proof');
  ok(wt, 'prove', 'add', 'fixed', '--covers', 'FR-01,FR-02', '--run', 'sh proofs/fixed.sh', '--files', 'proofs/fixed.sh', '--note', 'wrong checks a file that never exists');
  ok(wt, 'prove');
  // A locked proof is part of the goal: retire is always refused, however it is asked for.
  assert.throws(
    () => ok(wt, 'prove', 'retire', 'wrong', '--replaced-by', 'fixed', '--override', 'the check looks for a file that never exists'),
    (e: unknown) => e instanceof Refusal && /does not retire it/.test(e.message) && e.fixes.some((f) => /--not-done/.test(f)),
  );
  assert.equal(state().endProofs.list.find((p: { id: string }) => p.id === 'wrong').retired, undefined);

  const list = ok(wt, 'prove', 'list').message;
  assert.match(list, /wrong {2}red/);
  assert.match(list, /fixed {2}green/);
  refused(wt, /proofs do not show the end state: wrong is red/, 'advance');
  refused(wt, /proofs do not show the end state: wrong is red/, 'advance', '--call', 'a call does not pass a what check');
  ok(wt, 'advance', '--not-done', 'wrong looks for a file that never exists; fixed checks both requirements correctly');
  assert.equal(state().stage, 'review');
  assert.equal(state().notDone.length, 1);
  assert.match(state().notDone[0].what, /proofs do not show the end state: wrong is red/);
  assert.equal(state().endProofs.list.find((p: { id: string }) => p.id === 'wrong').retired, undefined, 'the wrong proof stays');
  assert.match(ok(wt, 'pr', 'body').message, /## Not done \(\d+\)[\s\S]*Proof: wrong is red/);
});
