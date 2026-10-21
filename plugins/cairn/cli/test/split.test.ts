import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { run } from '../src/main.ts';
import { childEnv, runSetup, runTests } from '../src/shared.ts';

let repo: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

// A state.json exactly as v0.1 wrote it: none of the v0.2 optional fields.
const V01_STATE = {
  schema: 1,
  slug: 'legacy',
  title: 'Legacy',
  track: 'feature',
  branch: 'sdlc/legacy',
  base: 'main',
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-02T00:00:00.000Z',
  stage: 'execute',
  paused: null,
  approvals: { prd: { at: '2026-01-01T00:00:00.000Z', via: 'human' }, plan: { at: '2026-01-01T00:00:00.000Z', via: 'agent' } },
  phases: [
    {
      id: 'core',
      name: 'Core',
      status: 'in_progress',
      slices: [
        { id: 'a', name: 'Alpha', covers: ['FR-01'], blockedBy: [], scope: ['src/a/**'], complexity: 'standard', status: 'done', fixRound: 0 },
        { id: 'b', name: 'Beta', covers: ['FR-02'], blockedBy: ['a'], scope: ['src/b/**'], complexity: 'simple', status: 'pending', fixRound: 0 },
      ],
    },
  ],
  evidence: {},
  drift: [{ path: 'src/x.ts', at: '2026-01-01T00:00:00.000Z', reason: 'edited outside slice "Alpha" scope' }],
  log: [{ at: '2026-01-01T00:00:00.000Z', event: 'created' }],
};

// Captured from `cairn status` on the unsplit commands.ts.
const GOLDEN_STATUS = 'Legacy (legacy): Execute · phase 1/1 "Core" · 1/2 slices done · 1 unreviewed drift\nNext: Start the next ready slices in phase "Core".\n! 1 file(s) changed outside the plan\'s scope';

before(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-split-')));
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

test('a v0.1 state.json without the v0.2 fields loads and status renders it byte-for-byte as before the split', () => {
  const wt = run(['new', 'legacy', '--title', 'Legacy'], repo).data!.worktree as string;
  const dir = join(wt, 'docs/sdlc/plans/legacy');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(V01_STATE, null, 2) + '\n');
  assert.equal(run(['status'], wt).message, GOLDEN_STATUS);
  assert.match(run(['status', '--all'], repo).message, /Legacy/);
});

test('childEnv drops CAIRN_APPROVER and keeps the rest of the environment', () => {
  process.env.CAIRN_APPROVER = 'x';
  try {
    const e = childEnv();
    assert.equal('CAIRN_APPROVER' in e, false);
    assert.equal(e.PATH, process.env.PATH);
  } finally {
    delete process.env.CAIRN_APPROVER;
  }
});

test('a test command cannot see CAIRN_APPROVER (FR-33)', () => {
  process.env.CAIRN_APPROVER = 'x';
  try {
    const t = runTests({ test: 'printf "%s" "$CAIRN_APPROVER"', maxParallel: 1, autoCommit: false }, repo);
    assert.equal(t?.ok, true);
    assert.equal(t?.tail, 'exit 0', 'the command printed nothing');
  } finally {
    delete process.env.CAIRN_APPROVER;
  }
});

test('a setup command cannot see CAIRN_APPROVER but still gets CAIRN_MAIN_ROOT (FR-33)', () => {
  process.env.CAIRN_APPROVER = 'x';
  try {
    runSetup({ setup: 'printf "[%s][%s]" "$CAIRN_APPROVER" "$CAIRN_MAIN_ROOT" > setup-out', maxParallel: 1, autoCommit: false }, repo, '/main');
    assert.equal(readFileSync(join(repo, 'setup-out'), 'utf8'), '[][/main]');
  } finally {
    delete process.env.CAIRN_APPROVER;
  }
});
