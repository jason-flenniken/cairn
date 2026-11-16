import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { hookSessionStart } from '../src/commands.ts';
import { run } from '../src/main.ts';
import type { State } from '../src/types.ts';
import { pd } from './plandir.ts';

// What a plan with Linear issues queues at ship, what the PR body says, and how a merge nobody ran cairn after is noticed.

let repo: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const write = (p: string, s: string) => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, s);
};
const ok = (cwd: string, ...argv: string[]) => run(argv, cwd);
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

before(() => {
  for (const [k, v] of Object.entries({ GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' })) process.env[k] = v;
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-linear-flow-')));
  g(repo, 'init', '-q', '-b', 'main');
  write(join(repo, 'README.md'), 'hi\n');
  write(join(repo, '.cairn/config.json'), JSON.stringify({ test: 'true', maxParallel: 3, linear: { team: 'SAV', statuses: { inReview: 'In Review' } } }));
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

const prd = (kids: string[], notTaken = '') =>
  `# P\n## Problem\np\n## Solution\ns\n## Requirements\n${kids.map((k, i) => `- **FR-0${i + 1}** thing ${i + 1} [${k}]. Check: works\n`).join('')}## Non-goals\n- n\n## Open questions\n- [x] q\n${notTaken}`;
const plan = (n: number) =>
  `## Goal\ng\n## Architecture\na\n## Phases\n\`\`\`yaml cairn-tasks\nphases:\n  - id: core\n    tasks:\n${Array.from({ length: n }, (_, i) => `      - { id: t${i + 1}, covers: [FR-0${i + 1}], scope: ["src/t${i + 1}/**"] }\n`).join('')}\`\`\`\n`;

/** A plan on an epic with the given sub-issues, taken up to ship (approved, built, reviewed). `later` sub-issues stay out of the plan. */
function toShip(slug: string, epic: string, kids: string[], later: string[] = []): { wt: string; dir: string } {
  const wt = ok(repo, 'new', slug, '--level', 'standard', '--no-proofs', '--title', slug).data!.worktree as string;
  const dir = pd(wt, slug);
  const issues = [{ key: epic, title: 'Epic' }, ...[...kids, ...later].map((k) => ({ key: k, title: `Issue ${k}`, parent: epic }))];
  run(['linear', 'import'], wt, JSON.stringify({ epic, selection: epic, issues }));
  ok(wt, 'decide', 'Scope?', 'The epic');
  ok(wt, 'advance');
  write(join(dir, 'prd.md'), prd(kids, later.length ? `## Issues not taken\n${later.map((k) => `- ${k}: later plan\n`).join('')}` : ''));
  byUser(wt, 'approve', 'prd');
  ok(wt, 'advance');
  write(join(dir, 'plan.md'), plan(kids.length));
  ok(wt, 'plan', 'load');
  byUser(wt, 'approve', 'plan');
  ok(wt, 'advance');
  kids.forEach((_, i) => {
    const id = `t${i + 1}`;
    const twt = ok(wt, 'task', 'start', id).data!.worktree as string;
    write(join(twt, `src/${id}/a.ts`), `export const x = '${id}';\n`);
    g(twt, 'add', '-A');
    g(twt, 'commit', '-q', '-m', id);
    g(wt, 'merge', '-q', '--no-ff', '-m', `merge ${id}`, `task/${slug}/${id}`);
    ok(wt, 'task', 'done', id);
  });
  // The last task done may already have finished the phase.
  if (stageOf(dir) === 'execute') ok(wt, 'phase', 'finish');
  ok(wt, 'evidence', 'verify', 'pass', '--note', 'ok');
  ok(wt, 'advance');
  ok(wt, 'evidence', 'review', 'pass', '--blocking', '0');
  ok(wt, 'advance');
  write(join(dir, 'RECORD.md'), '## Links\nprd\n## Why\nw\n## What was built\nb\n## How it works\nh\n## Findings\nNone.\n## Follow-ups\nnone\n');
  byUser(wt, 'approve', 'ship');
  return { wt, dir };
}

const stageOf = (dir: string) => (JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as State).stage;
const outbox = (dir: string) => (JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as State).linear!.outbox;
const row = (slug: string) => (ok(repo, 'status', '--all').data!.plans as { state: { slug: string }; mergedAwaitingDone?: boolean }[]).find((r) => r.state.slug === slug)!;

test('linear ship: the epic moves to In Review with its sub-issues, and the PR body says what to close', () => {
  const { wt, dir } = toShip('whole', 'SAV-300', ['SAV-301', 'SAV-302']);
  const closes = ok(wt, 'linear', 'closes');
  assert.equal(closes.message, 'Closes SAV-301\nCloses SAV-302\nCloses SAV-300');
  assert.deepEqual(closes.data!.closes, ['SAV-301', 'SAV-302', 'SAV-300']);
  ok(wt, 'advance', '--pr', 'https://github.com/o/r/pull/1');
  const moves = outbox(dir).filter((w) => w.dedupe.endsWith(':inReview')).map((w) => `${w.target}:${(w.payload as { state: string }).state}`);
  assert.deepEqual(moves.sort(), ['SAV-300:In Review', 'SAV-301:In Review', 'SAV-302:In Review']);
});

test('linear ship: an epic with a sub-issue the plan did not take stays where it is', () => {
  const { wt, dir } = toShip('partial', 'SAV-310', ['SAV-311'], ['SAV-312']);
  assert.equal(ok(wt, 'linear', 'closes').message, 'Closes SAV-311', 'the epic still has an open sub-issue');
  ok(wt, 'advance', '--pr', 'https://github.com/o/r/pull/2');
  assert.deepEqual(outbox(dir).filter((w) => w.dedupe.endsWith(':inReview')).map((w) => w.target), ['SAV-311']);
});

test('linear closes: nothing to print without Linear issues', () => {
  const wt = ok(repo, 'new', 'plain', '--level', 'standard', '--no-proofs', '--title', 'plain').data!.worktree as string;
  const r = run(['linear', 'closes'], wt);
  assert.equal(r.message, '');
  assert.deepEqual(r.data!.closes, []);
});

test('linear merge: a plan merged on GitHub is flagged until Done is queued, and session start says so', () => {
  assert.equal(row('whole').mergedAwaitingDone, false, 'not merged yet');
  assert.equal(row('plain').mergedAwaitingDone, false, 'no Linear issues');
  const hook = () => (JSON.parse(hookSessionStart({ cwd: repo }) || '{"hookSpecificOutput":{"additionalContext":""}}').hookSpecificOutput.additionalContext as string);
  assert.doesNotMatch(hook(), /pull request is merged/);
  g(repo, 'merge', '-q', '--no-ff', '-m', 'Merge whole', 'feature/whole');
  assert.equal(row('whole').mergedAwaitingDone, true);
  assert.equal(row('partial').mergedAwaitingDone, false, 'its branch has not landed');
  assert.match(hook(), /^cairn: whole's pull request is merged; run \/cairn:next to mark its Linear issues Done\.$/m);
  assert.doesNotMatch(hook(), /partial's pull request/);
  // A session in another plan's worktree is not told about this one: it is not that session's plan to act on.
  const inPartial = JSON.parse(hookSessionStart({ cwd: pdRoot('partial') }) || '{"hookSpecificOutput":{"additionalContext":""}}').hookSpecificOutput.additionalContext as string;
  assert.doesNotMatch(inPartial, /whole's pull request/);
  const wt = pdRoot('whole');
  const inWhole = JSON.parse(hookSessionStart({ cwd: wt })).hookSpecificOutput.additionalContext as string;
  assert.match(inWhole, /whole's pull request is merged/);
  ok(wt, 'linear', 'pending');
  assert.equal(row('whole').mergedAwaitingDone, false, 'Done is queued');
  assert.doesNotMatch(hook(), /whole's pull request is merged/);
});

const pdRoot = (slug: string) => g(repo, 'worktree', 'list', '--porcelain').split('\n\n').map((b) => b.split('\n')).find((b) => b.some((l) => l === `branch refs/heads/feature/${slug}`))![0].slice('worktree '.length);

/** Each issue's latest queued status, in queue order: what Linear would show once everything is sent. */
const shown = (dir: string) => {
  const out: Record<string, string> = {};
  for (const w of outbox(dir)) if (w.kind === 'status') out[w.target] = (w.payload as { state: string }).state;
  return out;
};

test('linear walkthrough: every issue, epic included, follows the plan from Build to merge', () => {
  const slug = 'walk';
  const wt = ok(repo, 'new', slug, '--level', 'standard', '--no-proofs', '--title', slug).data!.worktree as string;
  const dir = pd(wt, slug);
  run(['linear', 'import'], wt, JSON.stringify({ epic: 'SAV-400', selection: 'SAV-400', issues: [{ key: 'SAV-400', title: 'Epic' }, { key: 'SAV-401', title: 'A', parent: 'SAV-400' }, { key: 'SAV-402', title: 'B', parent: 'SAV-400' }] }));
  ok(wt, 'decide', 'Scope?', 'The epic');
  ok(wt, 'advance');
  write(join(dir, 'prd.md'), prd(['SAV-401', 'SAV-402']));
  byUser(wt, 'approve', 'prd');
  ok(wt, 'advance');
  write(join(dir, 'plan.md'), plan(2));
  ok(wt, 'plan', 'load');
  byUser(wt, 'approve', 'plan');
  ok(wt, 'advance');
  assert.equal(shown(dir)['SAV-400'], 'started', 'Build starts: the epic is In Progress');

  const build = (id: string) => {
    const twt = ok(wt, 'task', 'start', id).data!.worktree as string;
    write(join(twt, `src/${id}/a.ts`), `export const x = '${slug}-${id}';\n`);
    g(twt, 'add', '-A');
    g(twt, 'commit', '-q', '-m', id);
    g(wt, 'merge', '-q', '--no-ff', '-m', `merge ${id}`, `task/${slug}/${id}`);
    return ok(wt, 'task', 'done', id);
  };
  build('t1');
  assert.equal(stageOf(dir), 'execute');
  assert.notEqual(shown(dir)['SAV-402'], 'In Review', 'an unbuilt sub-issue is not in review');
  assert.match(build('t2').message, /moved to Check/);
  assert.equal(stageOf(dir), 'verify', 'the last task merged moves the plan to Check');

  ok(wt, 'evidence', 'verify', 'pass', '--note', 'ok');
  ok(wt, 'advance');
  ok(wt, 'evidence', 'review', 'pass', '--blocking', '0');
  ok(wt, 'advance');
  write(join(dir, 'RECORD.md'), '## Links\nprd\n## Why\nw\n## What was built\nb\n## How it works\nh\n## Findings\nNone.\n## Follow-ups\nnone\n');
  byUser(wt, 'approve', 'ship');
  ok(wt, 'advance', '--pr', 'https://github.com/o/r/pull/9');
  assert.deepEqual([shown(dir)['SAV-400'], shown(dir)['SAV-401'], shown(dir)['SAV-402']], ['In Review', 'In Review', 'In Review'], 'the PR opens: epic and sub-issues in review');

  g(repo, 'merge', '-q', '--no-ff', '-m', 'Merge walk', `feature/${slug}`);
  ok(wt, 'linear', 'pending');
  assert.deepEqual([shown(dir)['SAV-400'], shown(dir)['SAV-401'], shown(dir)['SAV-402']], ['completed', 'completed', 'completed'], 'merged: all Done');
});
