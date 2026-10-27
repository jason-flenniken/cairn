import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configWarning, loadConfig } from '../src/config.ts';
import { isCairnPath } from '../src/paths.ts';

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-paths-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

test('loadConfig reads .cairn/config.json', () => {
  const dir = repo({ '.cairn/config.json': '{"test":"t1"}' });
  assert.equal(loadConfig(dir).test, 't1');
});

test('loadConfig falls back to .sdlc/config.json', () => {
  const dir = repo({ '.sdlc/config.json': '{"test":"t2"}' });
  assert.equal(loadConfig(dir).test, 't2');
});

test('.cairn wins when both exist', () => {
  const dir = repo({ '.cairn/config.json': '{"test":"new"}', '.sdlc/config.json': '{"test":"old"}' });
  assert.equal(loadConfig(dir).test, 'new');
  assert.match(configWarning(dir)!, /both \.cairn\/config.json and \.sdlc\/config.json/);
});

test('configWarning is undefined with one file', () => {
  assert.equal(configWarning(repo({ '.cairn/config.json': '{}' })), undefined);
  assert.equal(configWarning(repo({ '.sdlc/config.json': '{}' })), undefined);
});

test('a JSON error names the file that was read', () => {
  assert.throws(() => loadConfig(repo({ '.sdlc/config.json': '{' })), /\.sdlc\/config\.json is not valid JSON/);
});

test('isCairnPath', () => {
  for (const p of ['docs/cairn/plans/x/state.json', 'docs/sdlc/plans/x/a.md', '.cairn/config.json', '.sdlc/config.json', '.claude/worktrees/x']) assert.equal(isCairnPath(p), true, p);
  for (const p of ['docs/cairnish.md', 'src/a.ts']) assert.equal(isCairnPath(p), false, p);
});
