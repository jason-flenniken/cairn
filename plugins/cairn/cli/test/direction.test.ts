import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { computeVerdict, parseScorecard } from '../src/direction.ts';
import { run } from '../src/main.ts';
import { Refusal } from '../src/util.ts';

let repo: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const write = (p: string, s: string) => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, s);
};
const ok = (cwd: string, ...argv: string[]) => run(argv, cwd);
const refused = (cwd: string, pattern: RegExp, ...argv: string[]) =>
  assert.throws(() => run(argv, cwd), (e: unknown) => e instanceof Refusal && pattern.test(e.message));
/** Act as the user through the mod: write the hash of a fresh secret and pass the secret in CAIRN_APPROVER. */
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

const PRD = `# PRD
## Problem
p
## Solution
s
## User stories
1. As a user I pay.
## Functional requirements
- FR-01 charge
- FR-02 refund
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
- [x] done
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
      - { id: receipt, name: Receipt, covers: [FR-01], scope: ["src/receipt/**"] }
\`\`\`
`;

type Row = Record<string, unknown>;
const aligned = (id: string): Row => ({ id, verdict: 'aligned', evidence: 'src/a.ts:1' });
const card = (c: { requirements?: Row[]; unplanned?: Row[]; nfr?: Row[] }) =>
  `# Direction: core\n\nReadable report.\n\n\`\`\`yaml cairn-direction\n${JSON.stringify({ requirements: c.requirements ?? [aligned('FR-01'), aligned('FR-02')], unplanned: c.unplanned ?? [], nfr: c.nfr ?? [] }, null, 2)}\n\`\`\`\n`;

let n = 0;
/** A plan with its first phase (FR-01, FR-02) awaiting approval. */
function awaiting(): { wt: string; dir: string; state: () => any } {
  const slug = `p${++n}`;
  const wt = ok(repo, 'new', slug, '--title', slug).data!.worktree as string;
  const dir = join(wt, 'docs/sdlc/plans', slug);
  ok(wt, 'decide', 'q', 'a');
  ok(wt, 'advance');
  write(join(dir, 'prd.md'), PRD);
  byUser(wt, 'approve', 'prd');
  ok(wt, 'advance');
  write(join(dir, 'plan.md'), PLAN);
  ok(wt, 'plan', 'load');
  byUser(wt, 'approve', 'plan');
  ok(wt, 'advance');
  for (const id of ['charge', 'refund']) {
    const swt = ok(wt, 'slice', 'start', id).data!.worktree as string;
    write(join(swt, `src/${id}/index.ts`), `export const ${id} = 1;\n`);
    g(swt, 'add', '-A');
    g(swt, 'commit', '-q', '-m', id);
    g(wt, 'merge', '-q', '--no-ff', '-m', `merge ${id}`, `sdlc-slice/${slug}/${id}`);
    ok(wt, 'slice', 'done', id);
  }
  const state = () => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  assert.equal(state().phases[0].status, 'awaiting_approval');
  return { wt, dir, state };
}
const report = (dir: string, md: string) => write(join(dir, 'direction/core.md'), md);

before(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-direction-')));
  g(repo, 'init', '-q', '-b', 'main');
  write(join(repo, 'README.md'), 'hi\n');
  write(join(repo, '.sdlc/config.json'), JSON.stringify({ test: 'true', maxParallel: 3 }));
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

test('computeVerdict: one partial requirement row is yellow', () => {
  const rows = { requirements: [aligned('FR-01'), { ...aligned('FR-02'), verdict: 'partial' }], unplanned: [], nfr: [] } as any;
  assert.equal(computeVerdict(rows), 'yellow');
});

test('computeVerdict: aligned and supporting rows only is green', () => {
  const rows = { requirements: [aligned('FR-01')], unplanned: [{ what: 'helper', class: 'supporting', evidence: 'a.ts:2' }], nfr: [aligned('NFR-01')] } as any;
  assert.equal(computeVerdict(rows), 'green');
});

test('computeVerdict: contradicted or missing rows are red, in requirements or nfr', () => {
  const base = { unplanned: [] };
  assert.equal(computeVerdict({ ...base, requirements: [{ ...aligned('FR-01'), verdict: 'contradicted' }], nfr: [] } as any), 'red');
  assert.equal(computeVerdict({ ...base, requirements: [aligned('FR-01')], nfr: [{ ...aligned('NFR-SEC'), verdict: 'missing' }] } as any), 'red');
});

test('computeVerdict: an unplanned row is yellow, a non-goal breach is red', () => {
  const req = [aligned('FR-01')];
  assert.equal(computeVerdict({ requirements: req, nfr: [], unplanned: [{ what: 'x', class: 'unplanned', evidence: 'a:1' }] } as any), 'yellow');
  assert.equal(computeVerdict({ requirements: req, nfr: [], unplanned: [{ what: 'x', class: 'pulled-forward', evidence: 'a:1' }] } as any), 'yellow');
  assert.equal(computeVerdict({ requirements: req, nfr: [], unplanned: [{ what: 'x', class: 'non-goal-breach', evidence: 'a:1' }] } as any), 'red');
});

test('parseScorecard returns the rows of a valid block', () => {
  const r = parseScorecard(card({}));
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows.requirements.length, 2);
});

test('parseScorecard reads a report with CRLF line endings', () => {
  const r = parseScorecard(card({}).replace(/\n/g, '\r\n'));
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows.requirements.length, 2);
});

test('computeVerdict: a requirement listed as both aligned and contradicted is red', () => {
  const rows = { requirements: [aligned('FR-01'), { ...aligned('FR-01'), verdict: 'contradicted' }], unplanned: [], nfr: [] } as any;
  assert.equal(computeVerdict(rows), 'red');
});

test('parseScorecard reports no block, two blocks, bad YAML (quoting the parser), bad verdicts, and evidence without path:line', () => {
  assert.match(parseScorecard('no block here').problems.join(), /no ```yaml cairn-direction block/);
  assert.match(parseScorecard(card({}) + card({})).problems.join(), /more than one/);
  assert.match(parseScorecard('```yaml cairn-direction\nrequirements: [unclosed\n```').problems.join(), /does not parse: .+/);
  assert.match(parseScorecard(card({ requirements: [{ id: 'FR-01', verdict: 'great', evidence: 'a.ts:1' }] })).problems.join(), /FR-01.*verdict/);
  assert.match(parseScorecard(card({ requirements: [{ id: 'FR-01', verdict: 'aligned', evidence: 'looks fine' }] })).problems.join(), /FR-01.*path:line/);
  assert.match(parseScorecard(card({ unplanned: [{ what: 'w', class: 'weird', evidence: 'a.ts:1' }] })).problems.join(), /class/);
});

test('evidence phase records yellow and the plan commit for one partial row', () => {
  const { wt, dir, state } = awaiting();
  report(dir, card({ requirements: [aligned('FR-01'), { ...aligned('FR-02'), verdict: 'partial', note: 'no refund email' }] }));
  const head = g(wt, 'rev-parse', 'HEAD');
  const out = ok(wt, 'evidence', 'phase', '--note', 'looks ok');
  assert.match(out.message, /yellow/);
  const v = state().phases[0].verdict;
  assert.equal(v.result, 'yellow');
  assert.equal(v.note, 'looks ok');
  assert.equal(v.commit, head);
});

test('evidence phase records green for aligned and supporting rows, and approval then succeeds', () => {
  const { wt, dir, state } = awaiting();
  report(dir, card({ unplanned: [{ what: 'helper', class: 'supporting', evidence: 'src/a.ts:3' }] }));
  ok(wt, 'evidence', 'phase');
  assert.equal(state().phases[0].verdict.result, 'green');
  byUser(wt, 'approve', 'phase');
  assert.equal(state().phases[0].status, 'done');
});

test('approval succeeds on yellow', () => {
  const { wt, dir, state } = awaiting();
  report(dir, card({ requirements: [aligned('FR-01'), { ...aligned('FR-02'), verdict: 'partial' }] }));
  ok(wt, 'evidence', 'phase');
  byUser(wt, 'approve', 'phase');
  assert.equal(state().phases[0].status, 'done');
});

test('evidence phase refuses when the phase is not waiting for approval', () => {
  const { wt, dir } = awaiting();
  report(dir, card({}));
  ok(wt, 'evidence', 'phase');
  byUser(wt, 'approve', 'phase');
  // the next phase is in progress, not waiting
  refused(wt, /no phase is waiting for approval|not waiting for approval/, 'evidence', 'phase');
});

test('evidence phase refuses with no report, naming the path', () => {
  const { wt } = awaiting();
  refused(wt, /direction\/core\.md does not exist/, 'evidence', 'phase');
});

test('evidence phase refuses an unparseable block and quotes the parser error', () => {
  const { wt, dir } = awaiting();
  report(dir, '```yaml cairn-direction\nrequirements: [unclosed\n```\n');
  refused(wt, /does not parse: .+/, 'evidence', 'phase');
});

test('evidence phase refuses when a covered requirement has no row, naming it', () => {
  const { wt, dir } = awaiting();
  report(dir, card({ requirements: [aligned('FR-01')] }));
  refused(wt, /no row for.*FR-02/, 'evidence', 'phase');
});

test('an extra row for an uncovered id does not hide a missing covered requirement', () => {
  const { wt, dir } = awaiting();
  report(dir, card({ requirements: [aligned('FR-01'), aligned('FR-99')] }));
  refused(wt, /no row for.*FR-02/, 'evidence', 'phase');
});

test('evidence phase refuses a row without path:line evidence', () => {
  const { wt, dir } = awaiting();
  report(dir, card({ requirements: [aligned('FR-01'), { id: 'FR-02', verdict: 'aligned', evidence: 'somewhere' }] }));
  refused(wt, /FR-02.*path:line/, 'evidence', 'phase');
});

test('approve phase refuses when no verdict was recorded', () => {
  const { wt } = awaiting();
  refusedByUser(wt, /no direction verdict/, 'approve', 'phase');
});

test('a red verdict refuses approval with proof alone, and an override with proof succeeds and is logged', () => {
  const { wt, dir, state } = awaiting();
  report(dir, card({ requirements: [aligned('FR-01'), { ...aligned('FR-02'), verdict: 'contradicted' }] }));
  ok(wt, 'evidence', 'phase');
  assert.equal(state().phases[0].verdict.result, 'red');
  refusedByUser(wt, /direction verdict is red/, 'approve', 'phase');
  assert.equal(state().phases[0].status, 'awaiting_approval');
  refused(wt, /^approvals come from the user, and this command has no proof that one did$/, 'approve', 'phase', '--override', 'ship it');
  byUser(wt, 'approve', 'phase', '--override', 'user accepts the gap');
  assert.equal(state().phases[0].status, 'done');
  assert.ok(state().log.some((l: { override?: string }) => l.override === 'user accepts the gap'));
});

test('a green verdict followed by a code commit refuses until the check is re-run', () => {
  const { wt, dir, state } = awaiting();
  report(dir, card({}));
  ok(wt, 'evidence', 'phase');
  write(join(wt, 'src/late.ts'), 'export {};\n');
  g(wt, 'add', '-A');
  g(wt, 'commit', '-q', '-m', 'late change');
  refusedByUser(wt, /code changed since the direction check/, 'approve', 'phase');
  const head = g(wt, 'rev-parse', 'HEAD');
  ok(wt, 'evidence', 'phase');
  assert.equal(state().phases[0].verdict.commit, head);
  byUser(wt, 'approve', 'phase');
  assert.equal(state().phases[0].status, 'done');
});

test('a commit touching only docs/sdlc does not make the verdict stale', () => {
  const { wt, dir, state } = awaiting();
  report(dir, card({}));
  ok(wt, 'evidence', 'phase');
  write(join(wt, 'docs/sdlc/plans/notes.md'), 'note\n');
  g(wt, 'add', '-A');
  g(wt, 'commit', '-q', '-m', 'docs only');
  byUser(wt, 'approve', 'phase');
  assert.equal(state().phases[0].status, 'done');
});

test('a code file moved into docs/sdlc after the verdict makes it stale', () => {
  const { wt, dir } = awaiting();
  report(dir, card({}));
  ok(wt, 'evidence', 'phase');
  mkdirSync(join(wt, 'docs/sdlc/plans'), { recursive: true });
  g(wt, 'mv', 'src/charge/index.ts', 'docs/sdlc/plans/moved.ts');
  g(wt, 'commit', '-q', '-m', 'move code under docs/sdlc');
  refusedByUser(wt, /code changed since the direction check/, 'approve', 'phase');
});

test('a re-plan clears every recorded phase verdict, on more than one phase', () => {
  const { wt, dir, state } = awaiting();
  report(dir, card({}));
  ok(wt, 'evidence', 'phase');
  byUser(wt, 'approve', 'phase');
  const swt = ok(wt, 'slice', 'start', 'receipt').data!.worktree as string;
  write(join(swt, 'src/receipt/index.ts'), 'export const r = 1;\n');
  g(swt, 'add', '-A');
  g(swt, 'commit', '-q', '-m', 'receipt');
  g(wt, 'merge', '-q', '--no-ff', '-m', 'merge receipt', `sdlc-slice/${state().slug}/receipt`);
  ok(wt, 'slice', 'done', 'receipt');
  write(join(dir, 'direction/extras.md'), card({ requirements: [aligned('FR-01')] }));
  ok(wt, 'evidence', 'phase');
  assert.ok(state().phases[0].verdict);
  assert.ok(state().phases[1].verdict);
  ok(wt, 'plan', 'load', '--replan');
  for (const p of state().phases) assert.equal(p.verdict, undefined);
});
