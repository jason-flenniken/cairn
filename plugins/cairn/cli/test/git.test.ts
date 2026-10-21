import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { commitPath } from '../src/git.ts';

// Deliberately does not import ./no-auto-gc.ts: this test checks the CLI protects itself.
test('CLI commits do not spawn detached background maintenance', () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-git-')));
  const trace = join(repo, '..', `${repo.split('/').pop()}.trace2`);
  const saved = { ...process.env };
  try {
    for (const k of Object.keys(process.env)) if (k.startsWith('GIT_CONFIG_')) delete process.env[k];
    Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    writeFileSync(join(repo, 'a.md'), 'a');
    process.env.GIT_TRACE2_EVENT = trace;
    assert.equal(commitPath(repo, 'a.md', 'add a'), true);
    const argvs = readFileSync(trace, 'utf8').match(/"argv":\[[^\]]*\]/g) ?? [];
    assert.ok(argvs.length > 0, 'trace captured git invocations');
    assert.deepEqual(argvs.filter((a) => /"(maintenance|gc)"/.test(a)), []);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    rmSync(repo, { recursive: true, force: true });
    rmSync(trace, { force: true });
  }
});
