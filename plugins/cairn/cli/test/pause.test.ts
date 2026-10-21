import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { run } from '../src/main.ts';

let repo: string;
let wt: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const AT = '2026-01-01T00:00:00.000Z';

const STATE = {
  schema: 1,
  slug: 'pausing',
  title: 'Pausing',
  track: 'feature',
  branch: 'feature/pausing',
  base: 'main',
  created: AT,
  updated: AT,
  stage: 'execute',
  paused: null,
  approvals: { prd: { at: AT, via: 'human' }, plan: { at: AT, via: 'agent' } },
  phases: [
    {
      id: 'core',
      name: 'Core',
      status: 'in_progress',
      tasks: [
        { id: 'a', name: 'Alpha', covers: ['FR-01'], blockedBy: [], scope: ['src/a/**'], complexity: 'standard', status: 'pending', fixRound: 0 },
        { id: 'b', name: 'Beta', covers: ['FR-02'], blockedBy: [], scope: ['src/b/**'], complexity: 'simple', status: 'pending', fixRound: 0 },
      ],
    },
  ],
  evidence: {},
  drift: [],
  log: [{ at: AT, event: 'created' }],
};

const ids = (out: { data?: Record<string, unknown> }) => (out.data!.ready as { id: string }[]).map((x) => x.id);

before(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-pause-')));
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
  wt = run(['new', 'pausing', '--title', 'Pausing'], repo).data!.worktree as string;
  const dir = join(wt, 'docs/sdlc/plans/pausing');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(STATE, null, 2) + '\n');
  writeFileSync(join(dir, 'handoff.md'), '## In flight\nnothing\n## Open questions\nnone\n## Next action\nstart alpha\n');
});
after(() => rmSync(repo, { recursive: true, force: true }));

test('while paused, cairn ready gives no ready tasks and cairn next names the resume procedure (FR-15)', () => {
  assert.deepEqual(ids(run(['ready', '--json'], wt)), ['a', 'b']);
  run(['pause'], wt);
  assert.deepEqual(ids(run(['ready', '--json'], wt)), []);
  assert.match(run(['next', '--json'], wt).data!.procedure as string, /procedures\/resume\.md$/);
  run(['resume'], wt);
  assert.deepEqual(ids(run(['ready', '--json'], wt)), ['a', 'b']);
});
