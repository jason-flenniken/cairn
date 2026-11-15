import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { issueFile, prdLinearProblems } from '../src/linear.ts';
import { run } from '../src/main.ts';
import { ids } from '../src/sections.ts';
import { issueDescription, keyedDecisions, renderSpecPrd, specCheck } from '../src/spec.ts';
import type { LinearIssue, LinearLink, State } from '../src/types.ts';
import { Refusal } from '../src/util.ts';
import { pd } from './plandir.ts';

const issue = (key: string, extra: Partial<LinearIssue> = {}): LinearIssue => ({ key, title: key, blockedBy: [], labels: ['cairn-spec'], ...extra });
const link = (issues: LinearIssue[], extra: Partial<LinearLink> = {}): LinearLink => ({ team: 'SAV', issues, known: [], importedAt: '', depends: [], changes: [], outbox: [], ...extra });

const EPIC_TEXT = `## Goal
Know which resolver works best.

## In scope
- A fixed list of 60 URLs
- A harness

## Out of scope
- Production resolver code, because that is M2

## Done when
- Every URL has a result row per path

## Trust boundaries
- Vendor responses are untrusted input

## Source
REQUIREMENTS.md section 7.1 (FR-CAP-7, FR-12)
`;
const leafText = (what: string, checks: string[]) => `## What
${what}

## Done when
${checks.map((c) => `- ${c}`).join('\n')}

## Source
REQUIREMENTS.md 7.1
`;

const ISSUES = [issue('SAV-22', { title: 'Resolver test' }), issue('SAV-73', { title: 'URL list', parent: 'SAV-22' }), issue('SAV-89', { title: 'Harness', parent: 'SAV-22', blockedBy: ['SAV-73'] }), issue('SAV-90', { title: 'Later', parent: 'SAV-22' })];
const TEXTS = new Map([
  ['SAV-22', EPIC_TEXT],
  ['SAV-73', leafText('A fixed list of 60 real URLs.', ['30 YouTube, 20 articles, 10 Reddit', 'Saved as a file the harness reads'])],
  ['SAV-89', leafText('A script that runs every URL through a resolver and meets FR-12.', ['Each row records success and cost.', 'A run can repeat one resolver'])],
  ['SAV-90', leafText('Something for later.', ['It works'])],
]);

test('spec check: no label is an ordinary plan; every issue needs the label and its sections', () => {
  assert.equal(specCheck(link(ISSUES.map((i) => ({ ...i, labels: [] }))), TEXTS), undefined);
  assert.deepEqual(specCheck(link(ISSUES), TEXTS), { ok: true, problems: [] });
  const one = specCheck(link([...ISSUES.slice(0, 3), { ...ISSUES[3], labels: ['Feature'] }]), TEXTS)!;
  assert.equal(one.ok, false);
  assert.deepEqual(one.problems, ['SAV-90 has no "cairn-spec" label']);
  const edited = new Map(TEXTS);
  edited.set('SAV-22', EPIC_TEXT.replace('## Out of scope\n- Production resolver code, because that is M2\n', ''));
  edited.set('SAV-73', '## What\nlist\n');
  edited.delete('SAV-89');
  assert.deepEqual(specCheck(link(ISSUES), edited)!.problems, ['SAV-22 is missing ## Out of scope', 'SAV-73 is missing ## Done when', "SAV-89's text was not read"]);
  assert.equal(specCheck(link(ISSUES.map((i, n) => (n === 3 ? { ...i, released: { at: '', reason: 'later' } } : i))), new Map([...TEXTS].filter(([k]) => k !== 'SAV-90')))!.ok, true, 'a released issue does not count');
});

test('spec prd: tickets map to sections, ids from the product spec stay text, decisions fill blockers and not-taken', () => {
  const decisions = `# Decisions\n\n### 1. Spec from tickets\n**Decision:** build from the tickets\n\n### 2. Not taken: SAV-90\n**Decision:** later plan\n**Why:** it waits on M2\n\n### 3. Outside blocker: SAV-19\n**Decision:** go ahead\n**Why:** the gateway is stubbed\n`;
  assert.deepEqual([...keyedDecisions(decisions, 'Not taken')], [['SAV-90', 'later plan, because it waits on M2']]);
  const l = link(ISSUES.map((i) => ({ ...i })), { epic: 'SAV-22', known: [{ key: 'SAV-19', title: 'Gateway', blockedBy: [], stateType: 'started' }] });
  l.issues[0].blockedBy = ['SAV-19'];
  const md = renderSpecPrd('Resolver test', l, TEXTS, decisions);
  assert.match(md, /## Problem\nKnow which resolver works best\./);
  assert.match(md, /## Solution\n- A fixed list of 60 URLs\n- A harness/);
  assert.match(md, /- \*\*FR-01\*\* A fixed list of 60 real URLs\. Check: 30 YouTube, 20 articles, 10 Reddit; Saved as a file the harness reads\. \[SAV-73\]/);
  assert.match(md, /- \*\*FR-02\*\* .*\[SAV-89\]/);
  assert.deepEqual(ids(md), ['FR-01', 'FR-02'], 'FR-12 from the ticket and the source is not read as a requirement id');
  assert.match(md, /## Non-goals\n- Production resolver code, because that is M2/);
  assert.match(md, /## Security\n- Vendor responses are untrusted input/);
  assert.match(md, /## Issues not taken\n- SAV-90: later plan, because it waits on M2/);
  assert.match(md, /## Outside blockers\n- SAV-19: go ahead, because the gateway is stubbed/);
  assert.deepEqual(prdLinearProblems(l, md), [], 'the PRD passes the Linear rules');
});

test('spec: a converted ticket\'s kept original text does not leak into its sections', () => {
  const original = '\n+++ Original\n\n**What:** old words\n\n## Done when\n* old check one\n* old check two\n\n## Context\nold\n\n+++\n';
  const converted = new Map(TEXTS);
  converted.set('SAV-89', TEXTS.get('SAV-89')! + original);
  converted.set('SAV-73', TEXTS.get('SAV-73')!.replace(/## Source[\s\S]*/, '') + '\n<details><summary>Original</summary>\n\n## Done when\n- stale\n</details>\n');
  const l = link(ISSUES.slice(0, 3).map((i) => ({ ...i })), { epic: 'SAV-22' });
  assert.deepEqual(specCheck(l, converted), { ok: true, problems: [] });
  const plain = renderSpecPrd('T', l, new Map([...TEXTS].map(([k, v]) => [k, k === 'SAV-73' ? v.replace(/## Source[\s\S]*/, '') : v])), '');
  assert.equal(renderSpecPrd('T', l, converted, ''), plain);
  assert.doesNotMatch(plain, /old check|stale/);
});

test('spec: issues already done in Linear need no stamp and are not taken', () => {
  const l = link([...ISSUES.slice(0, 3).map((i) => ({ ...i })), issue('SAV-74', { parent: 'SAV-22', labels: [], stateType: 'completed' })], { epic: 'SAV-22' });
  assert.deepEqual(specCheck(l, TEXTS), { ok: true, problems: [] });
  const md = renderSpecPrd('T', l, TEXTS, '');
  assert.match(md, /## Issues not taken\n- SAV-74: already done in Linear/);
  assert.deepEqual(prdLinearProblems(l, md), []);
});

test('spec prd: the description round-trips through the issue file', () => {
  const f = issueFile(ISSUES[0], EPIC_TEXT, 'now');
  assert.equal(issueDescription(f), EPIC_TEXT.trim());
});

// ---------- One specced epic through import, prd and plan ----------

let repo: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const write = (p: string, s: string) => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, s);
};
const ok = (cwd: string, ...argv: string[]) => run(argv, cwd);
const refused = (cwd: string, pattern: RegExp, ...argv: string[]) => assert.throws(() => run(argv, cwd), (e: unknown) => e instanceof Refusal && pattern.test(e.message));
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

before(() => {
  for (const [k, v] of Object.entries({ GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' })) process.env[k] = v;
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-spec-')));
  g(repo, 'init', '-q', '-b', 'main');
  write(join(repo, 'README.md'), 'hi\n');
  write(join(repo, '.cairn/config.json'), JSON.stringify({ test: 'true', linear: { team: 'SAV' } }));
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

const importDoc = (labels: (k: string) => string[]) => ({
  epic: 'SAV-22',
  selection: 'SAV-22',
  issues: ISSUES.slice(0, 3).map((i) => ({ key: i.key, title: i.title, labels: labels(i.key), description: TEXTS.get(i.key), ...(i.parent ? { parent: i.parent } : { parent: null }), blockedBy: i.blockedBy })),
});

test('specced epic: import flags it, linear prd writes an approvable PRD, the plan loads against it', () => {
  const wt = ok(repo, 'new', 'resolver-test', '--title', 'Resolver test').data!.worktree as string;
  const dir = pd(wt, 'resolver-test');
  const state = (): State => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  const msg = run(['linear', 'import'], wt, JSON.stringify(importDoc(() => ['cairn-spec', 'Spike']))).message;
  assert.match(msg, /Specced: every issue carries the cairn-spec label/);
  assert.deepEqual(state().linear!.spec, { ok: true, problems: [] });
  refused(wt, /built in the prd stage/, 'linear', 'prd');
  ok(wt, 'decide', 'Spec from tickets', 'Build from the tickets', '--why', 'they were specced with /cairn:spec');
  ok(wt, 'advance');
  write(join(dir, 'prd.md'), '# PRD\n## Requirements\n- **FR-01** hand written\n');
  refused(wt, /not built from the tickets/, 'linear', 'prd');
  assert.match(ok(wt, 'linear', 'prd', '--force').message, /2 requirements/);
  assert.match(ok(wt, 'linear', 'prd').message, /2 requirements/, 'a rebuild over its own output needs no --force');
  byUser(wt, 'approve', 'prd');
  assert.ok(state().approvals.prd);
  refused(wt, /already approved/, 'linear', 'prd');
  ok(wt, 'advance');
  write(join(dir, 'plan.md'), '## Goal\ng\n## Architecture\na\n## Phases\n```yaml cairn-tasks\nphases:\n  - id: one\n    tasks:\n      - { id: urls, covers: [FR-01], scope: ["urls/**"] }\n      - { id: harness, covers: [FR-02], scope: ["harness/**"], blocked_by: [urls] }\n```\n');
  ok(wt, 'plan', 'load');
  assert.deepEqual(state().phases[0].tasks.map((t) => t.issue), ['SAV-73', 'SAV-89']);
  g(repo, 'worktree', 'remove', '--force', wt);
  g(repo, 'branch', '-D', 'feature/resolver-test');
});

test('unstamped or partly stamped epic: no spec path, linear prd refuses', () => {
  const wt = ok(repo, 'new', 'plain-epic', '--title', 'Plain').data!.worktree as string;
  const dir = pd(wt, 'plain-epic');
  const msg = run(['linear', 'import'], wt, JSON.stringify(importDoc(() => ['Feature']))).message;
  assert.doesNotMatch(msg, /Specced/);
  assert.equal((JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as State).linear!.spec, undefined);
  refused(wt, /not specced with \/cairn:spec/, 'linear', 'prd');
  g(repo, 'worktree', 'remove', '--force', wt);
  g(repo, 'branch', '-D', 'feature/plain-epic');

  const wt2 = ok(repo, 'new', 'part-epic', '--title', 'Part').data!.worktree as string;
  const msg2 = run(['linear', 'import'], wt2, JSON.stringify(importDoc((k) => (k === 'SAV-89' ? [] : ['cairn-spec'])))).message;
  assert.match(msg2, /Specced, but not all of it: SAV-89 has no "cairn-spec" label/);
  refused(wt2, /not fully specced: SAV-89/, 'linear', 'prd');
  g(repo, 'worktree', 'remove', '--force', wt2);
  g(repo, 'branch', '-D', 'feature/part-epic');
});
