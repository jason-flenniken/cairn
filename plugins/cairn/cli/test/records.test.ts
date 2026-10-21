import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { run } from '../src/main.ts';

let repo: string;
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

before(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-records-')));
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

/** A closed plan that exists only as files in the main checkout. */
function closed(folder: string, slug: string, created: string, why?: string, suggestions: unknown[] = []) {
  const dir = join(repo, 'docs/sdlc/plans', folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ slug, title: `Plan ${slug}`, track: 'feature', stage: 'closed', created, branch: `feature/${slug}`, phases: [], approvals: {}, evidence: {}, drift: [], suggestions, log: [] }));
  if (why !== undefined) writeFileSync(join(dir, 'RECORD.md'), `# Record\n\n## Why\n${why}\n\n## What was built\nx\n`);
}

test('records lists the active plan first, then closed plans newest first, from main and from a plan worktree', () => {
  closed('2026-01-05-older', 'older', '2026-01-05T00:00:00Z', 'Old problem. More detail.');
  closed('newer', 'newer', '2026-03-01T00:00:00Z', 'Newer problem here.\nSecond line. Third.', [
    { id: 's1', at: '2026-03-02T00:00:00Z', text: 'tidy it', area: 'quality', where: [] },
  ]);
  closed('2026-02-01-norecord', 'norecord', '2026-02-01T00:00:00Z');
  const wt = run(['new', 'live', '--title', 'Live one'], repo).data!.worktree as string;

  for (const cwd of [repo, wt]) {
    const rec = run(['records', '--json'], cwd).data!.records as any[];
    assert.deepEqual(rec.map((r) => r.slug), ['live', 'newer', 'norecord', 'older']);
    const [live, newer, norecord, older] = rec;
    assert.equal(live.title, 'Live one');
    assert.notEqual(live.stage, 'closed');
    assert.equal(older.date, '2026-01-05');
    assert.equal(older.why, 'Old problem.');
    assert.equal(older.record, join(repo, 'docs/sdlc/plans/2026-01-05-older/RECORD.md'));
    assert.equal(newer.date, '2026-03-01');
    assert.equal(newer.why, 'Newer problem here.');
    assert.deepEqual(newer.followUps, [{ text: 'tidy it', area: 'quality', status: 'expired' }]);
    assert.equal(norecord.why, '');
    assert.equal(norecord.record, undefined);
  }
  assert.match(run(['records'], repo).message, /\[in progress: .*\]/);
});

test('a closed plan whose branch has the old folder takes its record and date from the dated folder on main', () => {
  g(repo, 'switch', '-q', '-c', 'feature/renamed');
  closed('renamed', 'renamed', '2026-12-31T00:00:00Z');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'legacy plan folder');
  g(repo, 'switch', '-q', 'main');
  closed('2026-10-20-renamed', 'renamed', '2026-12-31T00:00:00Z', 'Because.');
  const e = (run(['records', '--json'], repo).data!.records as any[]).find((r) => r.slug === 'renamed');
  assert.equal(e.record, join(repo, 'docs/sdlc/plans/2026-10-20-renamed/RECORD.md'));
  assert.equal(e.date, '2026-10-20');
  assert.equal(e.why, 'Because.');
});
