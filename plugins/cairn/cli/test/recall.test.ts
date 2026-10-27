import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { PlanEntry } from '../src/commands/records.ts';
import { hookSessionStart } from '../src/commands.ts';
import { run } from '../src/main.ts';
import { memoryIndex, recall } from '../src/memory.ts';
import type { State } from '../src/types.ts';

let repo: string;
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const write = (p: string, s: string) => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, s);
};
const SYSTEM = 'docs/cairn/system';
const areaDoc = (name: string, summary: string, ...paths: string[]) => `---\narea: ${name}\nsummary: ${summary}\npaths:\n${paths.map((p) => `  - ${p}`).join('\n')}\n---\n\n## Rules\n`;
const decision = (id: string, answer: string, areas: string[]) =>
  `---\nid: ${id}\nstatus: active\nareas: [${areas.join(', ')}]\nplan: p\ndate: 2026-01-02\n---\n\n# Q ${id}?\n\n**Decision:** ${answer}\n`;
const ctxOf = (out: string) => (out ? JSON.parse(out).hookSpecificOutput.additionalContext : '');
const mkState = (slug: string, over: Partial<State> = {}): State =>
  ({ slug, title: `Plan ${slug}`, track: 'feature', stage: 'closed', created: '2026-01-01T00:00:00Z', branch: `feature/${slug}`, phases: [], approvals: {}, evidence: {}, drift: [], suggestions: [], log: [], ...over }) as State;
const entry = (slug: string, date: string, over: Partial<State> = {}): PlanEntry => ({ state: mkState(slug, over), dir: `/x/${date}-${slug}`, date, record: `/wt/docs/cairn/plans/${date}-${slug}/RECORD.md` });
const taskPhase = (scope: string[]) => [{ name: 'p', tasks: [{ id: 't1', name: 't', scope }] }] as unknown as State['phases'];

/** A fresh throwaway directory (not a git repo) for the pure functions. */
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'cairn-recall-')));

before(() => {
  for (const k of ['GIT_AUTHOR_NAME', 'GIT_COMMITTER_NAME']) process.env[k] = 't';
  for (const k of ['GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_EMAIL']) process.env[k] = 't@t';
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-recall-repo-')));
  g(repo, 'init', '-q', '-b', 'main');
  write(join(repo, 'README.md'), 'hi\n');
  write(join(repo, SYSTEM, 'core.md'), areaDoc('Core', 'The core.', 'src/core/**'));
  write(join(repo, 'docs/cairn/decisions/2026-01-02-store.md'), decision('2026-01-02-store', 'Use files', ['core']));
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

test('recall finds area, decision, and plan', () => {
  write(join(repo, 'docs/cairn/plans/2026-01-03-old/RECORD.md'), '# Old\n');
  const plans = [entry('old', '2026-01-03', { areasTouched: ['core'] })];
  const r = recall(repo, ['src/core/a.ts'], plans);
  assert.deepEqual(r.areas.map((a) => a.id), ['core']);
  assert.deepEqual(r.decisions.map((d) => d.id), ['2026-01-02-store']);
  assert.deepEqual(r.plans.map((p) => p.slug), ['old']);
  assert.equal(r.plans[0].record, 'docs/cairn/plans/2026-01-03-old/RECORD.md');
  assert.deepEqual(r.uncovered, []);
  const out = run(['recall', 'src/core/a.ts'], repo);
  assert.match(out.message, /^Areas:\n {2}core: The core\. \(docs\/cairn\/system\/core\.md\)/m);
  assert.match(out.message, /^Decisions in force:\n {2}2026-01-02-store: Use files \(docs\/cairn\/decisions\/2026-01-02-store\.md\)/m);
  assert.deepEqual((out.data as { areas: unknown[] }).areas.length, 1);
});

test('recall reports uncovered globs', () => {
  assert.deepEqual(recall(repo, ['lib/**'], []).uncovered, ['lib/**']);
  assert.deepEqual(recall(repo, ['src/core/a.ts', 'lib/**'], []).uncovered, ['lib/**']);
  const out = run(['recall', 'src/core/a.ts', 'lib/**'], repo);
  assert.match(out.message, /^Not covered by any area: lib\/\*\*$/m);
  assert.match(run(['recall', 'lib/x.ts'], repo).message, /^Not covered by any area: lib\/x\.ts$/m);
});

test('recall with no args is a usage error', () => {
  assert.throws(() => run(['recall'], repo), /usage: cairn recall <path or glob>\.\.\./);
});

test('recall skips a broken area doc', () => {
  const root = tmp();
  write(join(root, SYSTEM, 'bad.md'), 'no frontmatter here\n');
  write(join(root, SYSTEM, 'core.md'), areaDoc('Core', 'The core.', 'src/core/**'));
  assert.deepEqual(recall(root, ['src/core/a.ts'], []).areas.map((a) => a.id), ['core']);
  rmSync(root, { recursive: true, force: true });
});

test('recall reports broken area docs in the text', () => {
  write(join(repo, SYSTEM, 'bad.md'), 'no frontmatter here\n');
  try {
    const out = run(['recall', 'src/core/a.ts'], repo);
    assert.match(out.message, /Area docs with problems: .*bad\.md has no frontmatter/);
    assert.match(out.message, /^Areas:/m);
  } finally {
    rmSync(join(repo, SYSTEM, 'bad.md'));
  }
});

test('a fix plan with ** is not a recall match unless areasTouched names the area', () => {
  const fix = (over: Partial<State>) => entry('fixit', '2026-02-01', { track: 'fix', phases: taskPhase(['**']), ...over });
  assert.deepEqual(recall(repo, ['src/core/a.ts'], [fix({})]).plans, []);
  assert.deepEqual(recall(repo, ['src/core/a.ts'], [fix({ areasTouched: ['core'] })]).plans.map((p) => p.slug), ['fixit']);
  // a closed plan with real scopes matches by scope even where no area covers the path
  const scoped = entry('scoped', '2026-02-02', { phases: taskPhase(['lib/**']) });
  assert.deepEqual(recall(repo, ['lib/x.ts'], [scoped]).plans.map((p) => p.slug), ['scoped']);
});

test('recall lists at most five plans, newest first', () => {
  const plans = Array.from({ length: 7 }, (_, i) => entry(`p${i}`, `2026-03-0${i + 1}`, { areasTouched: ['core'] }));
  assert.deepEqual(recall(repo, ['src/core/a.ts'], plans).plans.map((p) => p.slug), ['p6', 'p5', 'p4', 'p3', 'p2']);
});

test('session-start survives a broken memory', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-recall-broken-')));
  try {
    g(root, 'init', '-q', '-b', 'main');
    write(join(root, 'README.md'), 'hi\n');
    write(join(root, 'docs/cairn/system'), 'not a folder\n');
    g(root, 'add', '-A');
    g(root, 'commit', '-q', '-m', 'init');
    assert.doesNotThrow(() => hookSessionStart({ cwd: root }));
    const wt = run(['new', 'live', '--title', 'Live'], root).data!.worktree as string;
    assert.match(ctxOf(hookSessionStart({ cwd: wt })), /^cairn: Live/);
    assert.match(ctxOf(hookSessionStart({ cwd: root })), /1 active plan/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('index with no closed plans prints nothing', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-recall-empty-')));
  try {
    g(root, 'init', '-q', '-b', 'main');
    write(join(root, 'README.md'), 'hi\n');
    g(root, 'add', '-A');
    g(root, 'commit', '-q', '-m', 'init');
    assert.equal(run(['index'], root).message, '');
    assert.equal(ctxOf(hookSessionStart({ cwd: root })), '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('session-start still returns its plan lines when the changelog cannot be read', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-recall-throw-')));
  try {
    g(root, 'init', '-q', '-b', 'main');
    write(join(root, 'README.md'), 'hi\n');
    g(root, 'add', '-A');
    g(root, 'commit', '-q', '-m', 'init');
    const wt = run(['new', 'live', '--title', 'Live'], root).data!.worktree as string;
    assert.match(ctxOf(hookSessionStart({ cwd: wt })), /^cairn: Live/);
    assert.doesNotMatch(ctxOf(hookSessionStart({ cwd: wt })), /changelog/);
    assert.match(ctxOf(hookSessionStart({ cwd: root })), /1 active plan/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the plan list is read once for the index', () => {
  let called = 0;
  const lazy = () => (called++, []);
  assert.equal(memoryIndex(tmp(), lazy), '');
  assert.equal(called, 1);
});
