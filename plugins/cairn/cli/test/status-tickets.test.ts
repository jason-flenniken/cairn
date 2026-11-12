import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { taskIssuesOf } from '../src/commands/status.ts';
import { run } from '../src/main.ts';
import { loadState, saveState } from '../src/state.ts';
import type { LinearIssue, LinearLink, Phase, State, Task } from '../src/types.ts';
import { pd } from './plandir.ts';

const task = (name: string, covers: string[]): Task => ({ id: name, name, covers, blockedBy: [], scope: [], complexity: 'standard', status: 'pending', fixRound: 0 });
const phases = (...tasks: Task[]): Phase[] => [{ id: 'p', name: 'p', status: 'pending', tasks } as Phase];
const stateWith = (linear: LinearLink | undefined, p: Phase[]): State => ({ slug: 's', stage: 'execute', phases: p, linear } as unknown as State);
const link = (issues: LinearIssue[], extra: Partial<LinearLink> = {}): LinearLink => ({ team: 'SAV', issues, known: [], importedAt: '', depends: [], changes: [], outbox: [], ...extra });
const issue = (key: string, requirements?: string[], extra: Partial<LinearIssue> = {}): LinearIssue => ({ key, title: key, blockedBy: [], requirements, ...extra });

test('taskIssuesOf: maps each task to the keys whose requirements it covers, in pull-in order', () => {
  const s = stateWith(link([issue('SAV-1', ['FR-01']), issue('SAV-2', ['FR-02']), issue('SAV-3', ['FR-01', 'FR-03'])]), phases(task('form', ['FR-01']), task('pay', ['FR-02', 'FR-03']), task('both', ['FR-01', 'FR-02'])));
  assert.deepEqual(taskIssuesOf(s), { form: ['SAV-1', 'SAV-3'], pay: ['SAV-2', 'SAV-3'], both: ['SAV-1', 'SAV-2', 'SAV-3'] });
});

test('taskIssuesOf: a released issue is left out, and a task covering nothing maps to []', () => {
  const s = stateWith(link([issue('SAV-1', ['FR-01']), issue('SAV-2', ['FR-01'], { released: { at: '', reason: 'later' } })]), phases(task('form', ['FR-01']), task('prefactor', [])));
  assert.deepEqual(taskIssuesOf(s), { form: ['SAV-1'], prefactor: [] });
});

test('taskIssuesOf: a Linear link with no PRD tags yet maps every task to []', () => {
  const s = stateWith(link([issue('SAV-1'), issue('SAV-2')]), phases(task('form', ['FR-01'])));
  assert.deepEqual(taskIssuesOf(s), { form: [] });
});

test('taskIssuesOf: no Linear link, or a link with no issues, gives undefined', () => {
  assert.equal(taskIssuesOf(stateWith(undefined, phases(task('form', ['FR-01'])))), undefined);
  assert.equal(taskIssuesOf(stateWith(link([]), phases(task('form', ['FR-01'])))), undefined);
});

// ---------- End to end through `cairn status --all` ----------

let repo: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

before(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-status-tickets-')));
  g(repo, 'init', '-q', '-b', 'main');
  mkdirSync(join(repo, '.cairn'), { recursive: true });
  writeFileSync(join(repo, '.cairn/config.json'), JSON.stringify({ test: 'true', maxParallel: 3, linear: { team: 'SAV' } }));
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

test('cairn status --all: plan rows carry taskIssues and epic only for a Linear-linked plan', () => {
  // Linked plan: two PRD-tagged issues under one epic, and a released issue that must not appear.
  const linked = run(['new', 'linked-plan', '--title', 'Linked'], repo).data!.worktree as string;
  run(['linear', 'import'], linked, JSON.stringify({
    epic: 'SAV-100',
    issues: [
      { key: 'SAV-100', title: 'Epic' },
      { key: 'SAV-101', title: 'Card form', parent: 'SAV-100' },
      { key: 'SAV-102', title: 'Pay button', parent: 'SAV-100' },
      { key: 'SAV-103', title: 'Later', parent: 'SAV-100' },
    ],
  }));
  const dir = pd(linked, 'linked-plan');
  const s = loadState(dir);
  s.linear!.issues.find((i) => i.key === 'SAV-101')!.requirements = ['FR-01'];
  s.linear!.issues.find((i) => i.key === 'SAV-102')!.requirements = ['FR-02'];
  s.linear!.issues.find((i) => i.key === 'SAV-103')!.requirements = ['FR-01'];
  s.linear!.issues.find((i) => i.key === 'SAV-103')!.released = { at: '', reason: 'later plan' };
  s.phases = phases(task('form', ['FR-01']), task('pay', ['FR-02']));
  saveState(dir, s);

  // Unlinked plan: no Linear link at all.
  run(['new', 'bare-plan', '--title', 'Bare'], repo);

  const rows = run(['status', '--all'], repo).data!.plans as { state: State; taskIssues?: Record<string, string[]>; epic?: string }[];
  const linkedRow = rows.find((r) => r.state.slug === 'linked-plan')!;
  const bareRow = rows.find((r) => r.state.slug === 'bare-plan')!;
  assert.deepEqual(linkedRow.taskIssues, { form: ['SAV-101'], pay: ['SAV-102'] }, 'the released SAV-103 is left out');
  assert.equal(linkedRow.epic, 'SAV-100');
  assert.ok(!('taskIssues' in bareRow), 'a plan with no Linear link has no taskIssues key');
  assert.ok(!('epic' in bareRow), 'and no epic key');
});
