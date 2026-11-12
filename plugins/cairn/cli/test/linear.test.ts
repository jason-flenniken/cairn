import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { context, hookSessionStart } from '../src/commands.ts';
import { crossPlanBlockers } from '../src/commands/linear.ts';
import {
  effectiveBlockers,
  findIssueCycle,
  issueOrderProblems,
  issueProgress,
  issueRequirements,
  prdLinearProblems,
  readBoardImport,
  readPlanImport,
} from '../src/linear.ts';
import { run } from '../src/main.ts';
import { parsePlan } from '../src/plan-parse.ts';
import type { LinearIssue, LinearLink, State, Task } from '../src/types.ts';
import { CliError, Refusal } from '../src/util.ts';
import { pd } from './plandir.ts';

// ---------- Pure rules ----------

const issue = (key: string, extra: Partial<LinearIssue> = {}): LinearIssue => ({ key, title: key, blockedBy: [], ...extra });
const link = (issues: LinearIssue[], known: LinearIssue[] = []): LinearLink => ({ team: 'SAV', issues, known, importedAt: '', depends: [], changes: [], outbox: [] });

test('linear import: validates shape, keys and unknown fields', () => {
  assert.throws(() => readPlanImport({ issues: [] }), /non-empty list/);
  assert.throws(() => readPlanImport({ issues: [{ key: 'sav', title: 't' }] }), /not a Linear issue key/);
  assert.throws(() => readPlanImport({ issues: [{ key: 'SAV-1' }] }), /title is missing/);
  assert.throws(() => readPlanImport({ issues: [{ key: 'SAV-1', title: 't', colour: 'red' }] }), /unknown key: colour/);
  assert.throws(() => readPlanImport({ issues: [{ key: 'SAV-1', title: 't' }], extra: 1 }), /unknown key: extra/);
  assert.throws(() => readPlanImport({ issues: [{ key: 'SAV-1', title: 't' }, { key: 'SAV-1', title: 't' }] }), /twice/);
  const doc = readPlanImport({ epic: 'sav-1', issues: [{ key: 'sav-2', title: 'Two', parent: 'SAV-1', blockedBy: [{ key: 'SAV-9', title: 'Nine', stateType: 'Completed' }, 'SAV-2'] }] });
  assert.equal(doc.epic, 'SAV-1');
  assert.deepEqual(doc.issues[0].blockedBy, ['SAV-9'], 'keys upper-cased, a self link dropped');
  assert.deepEqual(doc.known.map((k) => [k.key, k.stateType]), [['SAV-9', 'completed']], 'an object blocker becomes known');
  assert.throws(() => readBoardImport({ issues: [] }), /project is missing/);
  const snapDoc = readBoardImport({ project: 'P', issues: [{ key: 'SAV-1', title: 't', blockedBy: [{ key: 'OPS-3', title: 'x' }] }] });
  assert.deepEqual([snapDoc.issues.length, snapDoc.known!.map((k) => k.key)], [1, ['OPS-3']], 'a blocker from elsewhere is known, not counted');
});

test('linear prd rules: tags, not-taken reasons, parents, outside blockers, cycles', () => {
  const l = link([issue('SAV-10'), issue('SAV-11', { parent: 'SAV-10' }), issue('SAV-12', { parent: 'SAV-10', blockedBy: ['SAV-90'] }), issue('SAV-13', { parent: 'SAV-10' })], [issue('SAV-90', { stateType: 'started' })]);
  const prd = (reqs: string, extra = '') => `## Requirements\n${reqs}\n## Unhappy paths\n- [FR-01] x\n${extra}`;
  const tags = issueRequirements(prd('- **FR-01** a [SAV-11]. Check: x\n- **FR-02** b [SAV-12, SAV-11]. Check: y\n- **FR-03** c [FR-01]'), ['SAV-11', 'SAV-12']);
  assert.deepEqual(Object.fromEntries(tags), { 'SAV-11': ['FR-01', 'FR-02'], 'SAV-12': ['FR-02'] });

  const p1 = prdLinearProblems(l, prd('- **FR-01** a [SAV-11]'));
  assert.match(p1[0], /SAV-12, SAV-13/);
  assert.doesNotMatch(p1[0], /SAV-10/, 'a parent with no criteria needs no tag');
  const p2 = prdLinearProblems(l, prd('- **FR-01** a [SAV-11]\n- **FR-02** b [SAV-12]', '## Issues not taken\n- SAV-13\n'));
  assert.ok(p2.some((x) => /lists SAV-13 without a reason/.test(x)));
  assert.ok(p2.some((x) => /SAV-90 \(blocks SAV-12\)/.test(x)));
  const full = prd('- **FR-01** a [SAV-11]\n- **FR-02** b [SAV-12]', '## Issues not taken\n- SAV-13: later plan\n## Outside blockers\n- SAV-90: go ahead, stubbed\n');
  assert.deepEqual(prdLinearProblems(l, full), []);
  assert.ok(prdLinearProblems(l, full.replace('- SAV-13: later plan', '- SAV-11: later plan\n- SAV-13: later plan')).some((x) => /SAV-11 is both on a requirement and under ## Issues not taken/.test(x)));
  // A blocker on the parent reaches every sub-issue.
  const viaParent = link([issue('SAV-10', { blockedBy: ['SAV-91'] }), issue('SAV-11', { parent: 'SAV-10' })], [issue('SAV-91')]);
  assert.deepEqual(effectiveBlockers(viaParent.issues[1], new Map([...viaParent.issues, ...viaParent.known].map((i) => [i.key, i]))), ['SAV-91']);
  assert.ok(prdLinearProblems(viaParent, prd('- **FR-01** a [SAV-11]')).some((x) => /SAV-91 \(blocks SAV-10, SAV-11\)/.test(x)));
  // A done blocker needs no decision.
  assert.deepEqual(prdLinearProblems(link([issue('SAV-11', { blockedBy: ['SAV-92'] })], [issue('SAV-92', { stateType: 'completed' })]), prd('- **FR-01** a [SAV-11]')), []);
  const loop = link([issue('SAV-1', { blockedBy: ['SAV-2'] }), issue('SAV-2', { blockedBy: ['SAV-1'] })]);
  assert.deepEqual(findIssueCycle(loop.issues), ['SAV-1', 'SAV-2', 'SAV-1']);
  assert.ok(prdLinearProblems(loop, prd('- **FR-01** a [SAV-1]\n- **FR-02** b [SAV-2]')).some((x) => /loop/.test(x)));
});

const PLAN_HEAD = '## Goal\ng\n## Architecture\na\n## Phases\n';
const planMd = (yaml: string, extra = '') => `${PLAN_HEAD}\`\`\`yaml cairn-tasks\nphases:\n${yaml}\`\`\`\n${extra}`;
const ORDER_PRD = '## Requirements\n- **FR-01** schema [SAV-1]\n- **FR-02** form [SAV-2]\n## Non-goals\nn\n## Open questions\n- [x] q\n';

test('linear plan order: a task for a blocked issue comes after its blocker, or says why not', () => {
  const l = link([issue('SAV-1'), issue('SAV-2', { blockedBy: ['SAV-1'] })]);
  const check = (md: string) => issueOrderProblems(l, parsePlan(md, ORDER_PRD).phases, ORDER_PRD, md);
  const same = planMd('  - id: one\n    tasks:\n      - { id: schema, covers: [FR-01], scope: ["a/**"] }\n      - { id: form, covers: [FR-02], scope: ["b/**"] }\n');
  assert.match(check(same)[0], /task "form" \(SAV-2\) must come after task "schema" \(SAV-1\)/);
  assert.deepEqual(check(same.replace('scope: ["b/**"]', 'scope: ["b/**"], blocked_by: [schema]')), [], 'blocked_by orders them');
  const phased = planMd('  - id: one\n    tasks:\n      - { id: schema, covers: [FR-01], scope: ["a/**"] }\n  - id: two\n    tasks:\n      - { id: form, covers: [FR-02], scope: ["b/**"] }\n');
  assert.deepEqual(check(phased), [], 'a later phase orders them');
  assert.deepEqual(check(same + "\n## Issue order\n- SAV-2's form does not read SAV-1's schema yet: it uses a stub\n"), [], 'a reason under ## Issue order lets it through');
  assert.equal(check(same + '\n## Issue order\n- SAV-2 SAV-1\n').length, 1, 'a line with no reason does not');
  // A blocker that is an epic in the plan stands for its sub-issues.
  const epicFirst = link([issue('SAV-1'), issue('SAV-3', { parent: 'SAV-1' }), issue('SAV-2', { blockedBy: ['SAV-1'] })]);
  const epicPrd = ORDER_PRD.replace('[SAV-1]', '[SAV-3]');
  assert.match(issueOrderProblems(epicFirst, parsePlan(same, epicPrd).phases, epicPrd, same)[0], /task "form" \(SAV-2\) must come after task "schema" \(SAV-1\)/);
  // A task covering both issues is not held to the rule.
  const both = planMd('  - id: one\n    tasks:\n      - { id: all, covers: [FR-01, FR-02], scope: ["a/**"] }\n');
  assert.deepEqual(check(both), []);
  // A dependency recorded mid-build counts like a Linear link.
  const free = link([issue('SAV-1'), issue('SAV-2')]);
  free.depends.push({ key: 'SAV-2', on: 'SAV-1', reason: 'r', at: '' });
  assert.equal(issueOrderProblems(free, parsePlan(same, ORDER_PRD).phases, ORDER_PRD, same).length, 1);
});

test('linear progress: derived from task status, rolled up to parents', () => {
  const t = (id: string, covers: string[], status: Task['status']): Task => ({ id, name: id, covers, blockedBy: [], scope: [], complexity: 'standard', status, fixRound: 0 });
  const s = {
    stage: 'execute',
    track: 'feature',
    phases: [{ id: 'p', name: 'p', status: 'in_progress', tasks: [t('a', ['FR-01'], 'done'), t('b', ['FR-02'], 'in_progress'), t('c', ['FR-03'], 'pending')] }],
    linear: link([
      issue('SAV-10'),
      issue('SAV-11', { parent: 'SAV-10', requirements: ['FR-01'] }),
      issue('SAV-12', { parent: 'SAV-10', requirements: ['FR-02'] }),
      issue('SAV-13', { requirements: ['FR-03'] }),
      issue('SAV-14', { released: { at: '', reason: 'later' } }),
    ]),
  } as unknown as State;
  assert.deepEqual(Object.fromEntries(issueProgress(s)), { 'SAV-10': 'in progress', 'SAV-11': 'built', 'SAV-12': 'in progress', 'SAV-13': 'not started', 'SAV-14': 'not taken' });
  s.phases[0].tasks.forEach((x) => (x.status = 'done'));
  assert.equal(issueProgress(s).get('SAV-10'), 'built');
  s.stage = 'learn';
  assert.equal(issueProgress(s).get('SAV-10'), 'shipped');
});

// ---------- One epic through every stage ----------

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
function byUser(cwd: string, ...argv: string[]) {
  const secret = randomBytes(16).toString('hex');
  mkdirSync(join(repo, '.git/cairn'), { recursive: true });
  writeFileSync(join(repo, '.git/cairn/mod-secret.sha256'), createHash('sha256').update(secret).digest('hex'), { mode: 0o600 });
  process.env.CAIRN_APPROVER = secret;
  try {
    return run(argv, cwd);
  } finally {
    delete process.env.CAIRN_APPROVER;
  }
}
const refusedByUser = (cwd: string, pattern: RegExp, ...argv: string[]) => assert.throws(() => byUser(cwd, ...argv), (e: unknown) => e instanceof Refusal && pattern.test(e.message));

before(() => {
  for (const [k, v] of Object.entries({ GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' })) process.env[k] = v;
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-linear-')));
  g(repo, 'init', '-q', '-b', 'main');
  write(join(repo, 'README.md'), 'hi\n');
  write(join(repo, '.cairn/config.json'), JSON.stringify({ test: 'true', maxParallel: 3, linear: { team: 'SAV' } }));
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

const EPIC = {
  project: 'Checkout',
  milestone: 'M1',
  epic: 'SAV-100',
  selection: 'SAV-100',
  issues: [
    { key: 'SAV-100', title: 'Checkout epic', milestone: 'M1', blockedBy: [{ key: 'SAV-90', title: 'Payments API', stateType: 'started' }] },
    { key: 'SAV-101', title: 'Card form', parent: 'SAV-100', milestone: 'M1' },
    { key: 'SAV-102', title: 'Pay button', parent: 'SAV-100', milestone: 'M1', blockedBy: ['SAV-101'] },
    { key: 'SAV-103', title: 'Receipt', parent: 'SAV-102', milestone: 'M2' },
    { key: 'SAV-104', title: 'Wallets', parent: 'SAV-100', milestone: 'M1' },
  ],
  known: [{ key: 'SAV-105', title: 'Copy', parent: 'SAV-100', stateType: 'completed' }],
};

const PRD = `# Checkout
## Problem
p
## Solution
s
## Requirements
- **FR-01** card form [SAV-101]. Check: shows
- **FR-02** pay button [SAV-102]. Check: pays
- **FR-03** receipt [SAV-103]. Check: emailed
## Non-goals
- n
## Open questions
- [x] q
`;
const PRD_FULL = `${PRD}## Issues not taken
- SAV-104: later plan, wallets need a vendor first
## Outside blockers
- SAV-90: go ahead, the API is stubbed until it lands
`;
const PLAN = (payBlocked: boolean) =>
  planMd(
    `  - id: core\n    tasks:\n      - { id: form, covers: [FR-01], scope: ["src/form/**"] }\n      - { id: pay, covers: [FR-02], scope: ["src/pay/**"]${payBlocked ? ', blocked_by: [form]' : ''} }\n  - id: after\n    tasks:\n      - { id: receipt, covers: [FR-03], scope: ["src/receipt/**"] }\n`,
  );

const sync = (wt: string) => {
  for (const w of ok(wt, 'linear', 'pending').data!.pending as { id: string; needsApproval?: boolean }[]) ok(wt, 'linear', 'sent', w.id);
};

function build(wt: string, slug: string, id: string, file: string) {
  const twt = ok(wt, 'task', 'start', id).data!.worktree as string;
  write(join(twt, file), `export const x = '${id}';\n`);
  g(twt, 'add', '-A');
  g(twt, 'commit', '-q', '-m', id);
  g(wt, 'merge', '-q', '--no-ff', '-m', `merge task ${id}`, `task/${slug}/${id}`);
  ok(wt, 'task', 'done', id);
}

test('linear: an epic from import to merged, with every check and queued write', () => {
  const wt = ok(repo, 'new', 'checkout', '--title', 'Checkout').data!.worktree as string;
  const dir = pd(wt, 'checkout');
  const state = (): State => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  const outbox = () => state().linear!.outbox;
  const file = join(repo, '..', `${repo.split('/').pop()}-epic.json`);
  writeFileSync(file, JSON.stringify(EPIC));

  // import: needs JSON, takes it once, warns about blockers outside the plan
  assert.throws(() => ok(wt, 'linear', 'import'), (e: unknown) => e instanceof CliError && /pipe them in/.test(e.message));
  assert.throws(() => run(['linear', 'import'], wt, '{nope'), /not valid JSON/);
  const imp = run(['linear', 'import'], wt, JSON.stringify(EPIC));
  assert.match(imp.message, /Pulled in 5 Linear issues/);
  assert.match(imp.message, /Epics SAV-100, SAV-102/);
  assert.match(imp.message, /SAV-103 \(M2\)/, 'a sub-issue in another milestone came along');
  assert.match(imp.message, /SAV-90 \(blocks SAV-100, SAV-101, SAV-102, SAV-103, SAV-104\)/, "the parent's blocker reaches its sub-issues");
  refused(wt, /already has its Linear issues/, 'linear', 'import', '--file', file);
  assert.equal(state().linear!.epic, 'SAV-100');

  // discover -> prd: issues must be tagged or left out with a reason; outside blockers need a decision
  ok(wt, 'decide', 'Scope?', 'The whole epic');
  ok(wt, 'advance');
  write(join(dir, 'prd.md'), PRD.replace(' [SAV-101]', ''));
  refusedByUser(wt, /no requirement and not under ## Issues not taken: SAV-101, SAV-104/, 'approve', 'prd');
  write(join(dir, 'prd.md'), `${PRD}## Issues not taken\n- SAV-104: later plan\n`);
  refusedByUser(wt, /no decision under ## Outside blockers: SAV-90 \(blocks SAV-100, SAV-101, SAV-102, SAV-103\)/, 'approve', 'prd');
  write(join(dir, 'prd.md'), PRD_FULL);
  byUser(wt, 'approve', 'prd');
  const after = state().linear!;
  assert.deepEqual(after.issues.find((i) => i.key === 'SAV-102')!.requirements, ['FR-02']);
  assert.match(after.issues.find((i) => i.key === 'SAV-104')!.released!.reason, /later plan/);
  assert.deepEqual(outbox().map((w) => w.target).sort(), ['SAV-101', 'SAV-102', 'SAV-103', 'SAV-104']);
  assert.ok(outbox().every((w) => w.kind === 'comment'));

  // next sends queued writes first; sent is idempotent
  assert.match(ok(wt, 'next').data!.procedure as string, /linear-sync\.md$/);
  assert.match(JSON.parse(hookSessionStart({ cwd: wt })).hookSpecificOutput.additionalContext, /4 Linear updates waiting/);
  const first = (ok(wt, 'linear', 'pending').data!.pending as { id: string; tool: string; payload: { issueId: string } }[])[0];
  assert.equal(first.tool, 'save_comment');
  assert.ok(first.payload.issueId);
  ok(wt, 'linear', 'sent', first.id, '--ref', 'https://linear.app/c/1');
  assert.match(ok(wt, 'linear', 'sent', first.id).message, /already sent/);
  sync(wt);
  assert.doesNotMatch(ok(wt, 'next').data!.procedure as string, /linear-sync/);

  // plan: tasks follow issue order
  ok(wt, 'advance');
  write(join(dir, 'plan.md'), PLAN(false));
  refused(wt, /task "pay" \(SAV-102\) must come after task "form" \(SAV-101\)/, 'plan', 'load');
  write(join(dir, 'plan.md'), PLAN(true));
  ok(wt, 'plan', 'load');
  byUser(wt, 'approve', 'plan');
  ok(wt, 'advance');
  const started = outbox().filter((w) => w.kind === 'status');
  assert.deepEqual(started.map((w) => w.payload), ['SAV-100', 'SAV-101', 'SAV-102', 'SAV-103'].map((id) => ({ id, state: 'started' })), 'In Progress by status type');
  sync(wt);

  // a refresh brings a new link and a new sub-issue; the phase can't finish until both are handled
  const fresh = structuredClone(EPIC) as typeof EPIC & { issues: Record<string, unknown>[] };
  (fresh.issues[1] as { blockedBy?: unknown }).blockedBy = [{ key: 'SAV-91', title: 'Tokens', stateType: 'unstarted' }];
  fresh.issues.push({ key: 'SAV-106', title: 'Saved cards', parent: 'SAV-100' });
  // SAV-104 was already left out; moving it in Linear changes nothing for the plan.
  (fresh.issues[4] as { parent?: string | null }).parent = null;
  const ref = run(['linear', 'import', '--refresh'], wt, JSON.stringify(fresh));
  assert.match(ref.message, /c1: SAV-101 is now blocked by SAV-91/);
  assert.match(ref.message, /c2: SAV-106 "Saved cards" was added under SAV-100/);
  assert.ok((ok(wt, 'status').data!.warnings as string[]).some((w) => /Linear: 2 changes to decide/.test(w)), 'open changes show as a warning');
  build(wt, 'checkout', 'form', 'src/form/a.ts');
  build(wt, 'checkout', 'pay', 'src/pay/a.ts');
  refused(wt, /changes in Linear are not handled yet: c1 .*; c2/, 'phase', 'finish');
  const dep = ok(wt, 'linear', 'depends', 'SAV-101', '--on', 'SAV-91', '--reason', 'needs the token API');
  assert.match(dep.message, /outside this plan and not done/);
  assert.ok(!outbox().some((w) => w.kind === 'relation'), 'Linear already has that link: nothing to write');
  ok(wt, 'linear', 'ack', 'c2', '--as', 'later');
  assert.equal(state().linear!.issues.find((i) => i.key === 'SAV-106')!.released!.reason, 'later plan');
  ok(wt, 'phase', 'finish');
  assert.ok(outbox().some((w) => w.dedupe === 'comment:SAV-101:built'), 'a built issue gets a comment');
  assert.ok(!outbox().some((w) => w.dedupe === 'comment:SAV-103:built'), 'an unbuilt one does not');

  // a dependency found while building is linked in Linear, once
  ok(wt, 'linear', 'depends', 'SAV-103', '--on', 'SAV-95', '--reason', 'needs the mailer');
  const rel = outbox().filter((w) => w.kind === 'relation');
  assert.deepEqual(rel.map((w) => w.payload), [{ id: 'SAV-103', blockedBy: ['SAV-95'] }]);
  const n = outbox().length;
  assert.match(ok(wt, 'linear', 'depends', 'SAV-103', '--on', 'SAV-95', '--reason', 'again').message, /Already recorded/);
  assert.equal(outbox().length, n);
  refused(wt, /loop/, 'linear', 'depends', 'SAV-101', '--on', 'SAV-103', '--reason', 'r');
  sync(wt);

  // another plan built on this one can't ship first
  const wt2 = ok(repo, 'new', 'mail', '--title', 'Mail').data!.worktree as string;
  const imp2 = run(['linear', 'import'], wt2, JSON.stringify({ issues: [{ key: 'SAV-107', title: 'Mail receipts', blockedBy: ['SAV-103'] }] }));
  assert.match(imp2.message, /SAV-103 \[in plan checkout, execute\] \(blocks SAV-107\)/);
  const s2 = JSON.parse(readFileSync(join(pd(wt2, 'mail'), 'state.json'), 'utf8'));
  assert.deepEqual(crossPlanBlockers(context(wt2), s2), ['SAV-107 needs SAV-103, which plan checkout has not shipped (it is in execute)']);

  // finish, ship with the PR link, close with a follow-up
  ok(wt, 'suggest', 'add', '--area', 'tests', '--where', 'src/pay/**', '--text', 'cover declined cards');
  build(wt, 'checkout', 'receipt', 'src/receipt/a.ts');
  ok(wt, 'phase', 'finish');
  ok(wt, 'evidence', 'verify', 'pass', '--note', 'ok');
  ok(wt, 'advance');
  ok(wt, 'evidence', 'review', 'pass', '--blocking', '0');
  ok(wt, 'advance');
  write(join(dir, 'RECORD.md'), '## Links\nprd\n## Why\nw\n## What was built\nb\n## How it works\nh\n## Findings\nNone.\n## Follow-ups\nnone\n');
  byUser(wt, 'approve', 'ship');
  ok(wt, 'advance', '--pr', 'https://github.com/o/r/pull/7');
  assert.ok(!outbox().some((w) => w.dedupe.endsWith(':inReview')), 'no review status type and none configured: a comment only');
  assert.match(outbox().find((w) => w.dedupe === 'comment:SAV-101:pr')!.payload.body as string, /pull\/7/);
  assert.match(outbox().find((w) => w.dedupe === 'comment:SAV-100:epic:checkout')!.payload.body as string, /3 of 4 sub-issues shipped/);
  assert.deepEqual(crossPlanBlockers(context(wt2), s2), ['SAV-107 needs SAV-103, which plan checkout has not merged yet'], 'closed comes before the merge');
  ok(wt, 'close');
  const create = outbox().find((w) => w.kind === 'createIssue')!;
  assert.equal(create.target, 'checkout:s1');
  assert.deepEqual((create.payload as { labels: string[] }).labels, ['cairn-follow-up']);
  assert.equal(create.payload.project, 'Checkout');
  const update = outbox().find((w) => w.kind === 'statusUpdate')!;
  assert.equal(update.needsApproval, true);
  ok(wt, 'linear', 'sent', create.id, '--ref', 'SAV-200');
  assert.equal(state().suggestions![0].linear, 'SAV-200', 'the follow-up remembers its issue');
  ok(wt, 'linear', 'drop', update.id, '--note', 'the user declined');
  refused(wt, /was dropped/, 'linear', 'sent', update.id);
  sync(wt);

  // merged: Done for each issue; a parent only once every sub-issue is done
  g(repo, 'merge', '-q', '--no-ff', '-m', 'Merge checkout', 'feature/checkout');
  const owed = ok(repo, 'next').data!;
  assert.match(owed.procedure as string, /linear-sync\.md$/, 'next on main finds the merged plan');
  assert.equal(owed.planWorktree, wt);
  assert.match(ok(wt, 'next').data!.procedure as string, /linear-sync\.md$/, 'next sees the merge and queues the Done statuses');
  assert.match(ok(repo, 'next').data!.procedure as string, /status\.md$/, 'once queued, main no longer points at it');
  assert.deepEqual(crossPlanBlockers(context(wt2), s2), [], 'merged: the other plan may go ahead');
  const done = ok(wt, 'linear', 'pending').data!.pending as { target: string; payload: { state: string } }[];
  assert.deepEqual(done.map((w) => w.target).sort(), ['SAV-101', 'SAV-102', 'SAV-103']);
  assert.ok(done.every((w) => w.payload.state === 'completed'));
  assert.ok(!done.some((w) => w.target === "SAV-100"), "SAV-106 is still open under the epic");

  // the board joins a project snapshot with every plan
  refused(repo, /no Linear project has been read yet/, 'linear', 'board');
  const snap = {
    project: 'Checkout',
    milestones: ['M1', 'M2'],
    issues: [
      ...EPIC.issues.map((i) => ({ ...i, blockedBy: (i.blockedBy ?? []).map((b) => (typeof b === 'string' ? b : b.key)) })),
      { key: 'SAV-90', title: 'Payments API', stateType: 'started' },
      { key: 'SAV-105', title: 'Copy', parent: 'SAV-100', milestone: 'M1', stateType: 'completed' },
      { key: 'SAV-107', title: 'Mail receipts', milestone: 'M2', blockedBy: ['SAV-103'] },
      { key: 'SAV-108', title: 'Gift cards', milestone: 'M2' },
      { key: 'SAV-109', title: 'Loop a', milestone: 'M2', blockedBy: ['SAV-110'] },
      { key: 'SAV-110', title: 'Loop b', milestone: 'M2', blockedBy: ['SAV-109'] },
      { key: 'SAV-111', title: 'Orphan', milestone: 'M2', parent: 'OPS-1', blockedBy: [{ key: 'OPS-2', title: 'Infra', stateType: 'completed' }] },
    ],
  };
  run(['linear', 'import', '--board'], repo, JSON.stringify(snap));
  const b = ok(repo, 'linear', 'board');
  assert.match(b.message, /^Checkout: read from Linear 0 min ago\./);
  assert.match(b.message, /epic SAV-100 Checkout epic: 1\/4 done, plans: checkout/);
  assert.match(b.message, /▸ SAV-101 Card form: checkout \(closed, shipped\)/);
  assert.match(b.message, /▸ SAV-107 Mail receipts: mail \(discover, not started\)/);
  assert.match(b.message, /○ SAV-108 Gift cards/);
  assert.match(b.message, /✗ SAV-104 Wallets: blocked by SAV-90/);
  assert.match(b.message, /Loop in blocked-by links: SAV-109 → SAV-110 → SAV-109/);
  const m2 = (b.data!.milestones as { name: string; counts: Record<string, number> }[]).find((m) => m.name === 'M2')!;
  assert.deepEqual(m2.counts, { total: 6, done: 0, inPlan: 2, ready: 2, blocked: 2 }, 'OPS-2 is not counted, and done');
  assert.match(b.message, /○ SAV-111 Orphan/, 'a sub-issue whose parent is elsewhere is listed');
  assert.doesNotMatch(b.message, /OPS-2/);
  const one = ok(repo, 'linear', 'board', '--epic', 'sav-100');
  assert.equal((one.data!.milestones as unknown[]).length, 1);
  assert.doesNotMatch(one.message, /SAV-108/);
  assert.match(one.message, /epic SAV-100 Checkout epic: 1\/4 done/);
  refused(repo, /SAV-108 is not an epic/, 'linear', 'board', '--epic', 'SAV-108');
  assert.equal(ok(repo, 'linear', 'board', '--project', 'Checkout').data!.project, 'Checkout');
  refused(repo, /no snapshot of "Nope"/, 'linear', 'board', '--project', 'Nope');
});

test('linear: nothing runs without the config block', () => {
  const bare = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-nolinear-')));
  try {
    g(bare, 'init', '-q', '-b', 'main');
    write(join(bare, 'README.md'), 'hi\n');
    g(bare, 'add', '-A');
    g(bare, 'commit', '-q', '-m', 'init');
    const wt = ok(bare, 'new', 'plain', '--title', 'Plain').data!.worktree as string;
    refused(wt, /Linear is not set up for this repo/, 'linear', 'import', '--file', join(bare, 'README.md'));
    refused(wt, /no Linear issues/, 'linear', 'pending');
    ok(wt, 'decide', 'q', 'a');
    ok(wt, 'advance');
    const s = JSON.parse(readFileSync(join(pd(wt, 'plain'), 'state.json'), 'utf8'));
    assert.equal(s.linear, undefined);
    assert.match(ok(wt, 'next').data!.procedure as string, /prd\.md$/);
    assert.ok(!existsSync(join(bare, '.git/cairn/linear')));
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
});

test('linear refresh: a sub-issue moved out of the epic leaves the plan and says so', () => {
  const wt = ok(repo, 'new', 'moved', '--title', 'Moved').data!.worktree as string;
  const epic = { epic: 'SAV-300', issues: [{ key: 'SAV-300', title: 'Epic' }, { key: 'SAV-301', title: 'Child', parent: 'SAV-300' }, { key: 'SAV-302', title: 'Other', parent: 'SAV-300', blockedBy: ['SAV-399'] }] };
  run(['linear', 'import'], wt, JSON.stringify(epic));
  const moved = structuredClone(epic);
  (moved.issues[1] as { parent?: string | null }).parent = null;
  // A refresh that did not read SAV-302's links or parent keeps them.
  delete (moved.issues[2] as { blockedBy?: string[] }).blockedBy;
  delete (moved.issues[2] as { parent?: string }).parent;
  const r = run(['linear', 'import', '--refresh'], wt, JSON.stringify(moved));
  assert.match(r.message, /SAV-301 was moved out of SAV-300 in Linear, so it left the plan/);
  const l = (JSON.parse(readFileSync(join(pd(wt, 'moved'), 'state.json'), 'utf8')) as State).linear!;
  assert.equal(l.issues.find((i) => i.key === 'SAV-301')!.released!.reason, 'moved out of SAV-300 in Linear');
  assert.ok(l.outbox.some((w) => w.dedupe === 'comment:SAV-301:released'));
  const other = l.issues.find((i) => i.key === 'SAV-302')!;
  assert.equal(other.released, undefined);
  assert.deepEqual(other.blockedBy, ['SAV-399'], 'links the refresh did not carry are kept');
  assert.equal(other.parent, 'SAV-300');
  // A held write waits for the next sync; it doesn't send every `cairn next` to the sync.
  assert.match(ok(wt, 'next').data!.procedure as string, /linear-sync\.md$/);
  const id = (ok(wt, 'linear', 'pending').data!.pending as { id: string }[])[0].id;
  ok(wt, 'linear', 'hold', id, '--note', 'Linear tools are not connected');
  assert.match(ok(wt, 'next').data!.procedure as string, /discover\.md$/);
  assert.match(ok(wt, 'linear', 'pending').message, /held: Linear tools are not connected/);
  ok(wt, 'linear', 'sent', id);
  assert.equal((ok(wt, 'linear', 'pending').data!.pending as unknown[]).length, 0);
});
