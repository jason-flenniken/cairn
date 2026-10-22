import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { run } from '../src/main.ts';
import { stageTimes } from '../src/state.ts';
import type { State } from '../src/types.ts';
import { pd } from './plandir.ts';

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

let repo: string;
before(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-timing-')));
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

const MIN = 60_000;
const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const at = (min: number) => new Date(T0 + min * MIN).toISOString();
const history = (...rows: [State['stage'], number][]) => rows.map(([stage, m]) => ({ stage, at: at(m) }));
/** A bare state with only what the timing needs. */
const bare = (over: Partial<State>): State => ({ stage: 'discover', paused: null, log: [], ...over }) as State;

test('advancing discover to prd records two history entries, and the discover time is the gap between them', () => {
  const wt = run(['new', 'timed', '--title', 'Timed'], repo).data!.worktree as string;
  run(['decide', 'Which?', 'This one'], wt);
  run(['advance'], wt);
  const s = JSON.parse(readFileSync(join(pd(wt, 'timed'), 'state.json'), 'utf8')) as State;
  assert.deepEqual(s.stageHistory!.map((h) => h.stage), ['discover', 'prd']);
  const gap = Date.parse(s.stageHistory![1].at) - Date.parse(s.stageHistory![0].at);
  assert.equal(stageTimes(s)!.discover, gap);
  const timing = (run(['status', '--json'], wt).data as { timing: Record<string, number> }).timing;
  assert.equal(timing.discover, gap);
  assert.ok(timing.prd >= 0);
});

test('a paused interval is excluded from the stage time', () => {
  const s = bare({
    stage: 'prd',
    stageHistory: history(['discover', 0], ['prd', 30]),
    log: [
      { at: at(10), event: 'paused' },
      { at: at(25), event: 'resumed' },
    ],
  });
  assert.equal(stageTimes(s, T0 + 40 * MIN)!.discover, 15 * MIN);
  assert.equal(stageTimes(s, T0 + 40 * MIN)!.prd, 10 * MIN);
});

test('a plan paused now reports its current stage frozen at the pause time', () => {
  const s = bare({
    stage: 'plan',
    stageHistory: history(['discover', 0], ['plan', 10]),
    paused: { at: at(20), mode: 'drain' },
    log: [{ at: at(20), event: 'paused' }],
  });
  assert.equal(stageTimes(s, T0 + 500 * MIN)!.plan, 10 * MIN);
  assert.equal(stageTimes(s, T0 + 900 * MIN)!.plan, 10 * MIN);
});

test('re-plan back to plan, then plan to execute again, sums both plan visits', () => {
  const s = bare({
    stage: 'execute',
    stageHistory: history(['plan', 0], ['execute', 10], ['plan', 30], ['execute', 35]),
  });
  const t = stageTimes(s, T0 + 50 * MIN)!;
  assert.equal(t.plan, 15 * MIN);
  assert.equal(t.execute, 35 * MIN);
});

test('a plan with no history reports n/a, not zero', () => {
  assert.equal(stageTimes(bare({ stage: 'execute' }), T0), null);
});

test('a closed plan stops counting at close', () => {
  const s = bare({ stage: 'closed', stageHistory: history(['learn', 0], ['closed', 5]) });
  const t = stageTimes(s, T0 + 999 * MIN)!;
  assert.equal(t.learn, 5 * MIN);
  assert.equal(t.closed, undefined);
});

test('no command assigns stage outside setStage', () => {
  const src = join(import.meta.dirname, '../src');
  const files = [src, join(src, 'commands')].flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.ts')).map((f) => join(d, f)));
  const offenders = files.filter((f) => !f.endsWith('/src/state.ts')).filter((f) => /\.stage\s*=[^=]/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
});
