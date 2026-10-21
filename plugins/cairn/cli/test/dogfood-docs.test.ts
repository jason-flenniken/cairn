import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pluginRoot } from '../src/util.ts';

const root = pluginRoot();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('new.md never calls EnterWorktree and tells the user the worktree path', () => {
  const src = read('procedures/new.md');
  assert.doesNotMatch(src, /EnterWorktree/);
  assert.match(src, /worktree path/);
});

test('execute.md runs cairn from the plan worktree with cd', () => {
  const src = read('procedures/execute.md');
  assert.match(src, /cd <plan worktree> && cairn/);
});

test('execute.md and review.md run the override command alone', () => {
  for (const f of ['procedures/execute.md', 'procedures/review.md']) {
    const src = read(f);
    assert.match(src, /override[^\n]*(alone|on its own)/i, f);
    assert.doesNotMatch(src, /cd [^\n]*&&[^\n]*--override/, f);
  }
});

test('review.md gives the override reason as plain text without shell metacharacters', () => {
  const src = read('procedures/review.md');
  const line = src.split('\n').find((l) => l.includes('cairn advance --override'));
  assert.ok(line, 'has the override command');
  const reason = line.match(/--override "([^"]*)"/)?.[1] ?? '';
  assert.doesNotMatch(reason, /[;|&$`><\\#*?~(){}[\]]/);
});

test('cli.md documents the secret hash and never mentions grants or rotation', () => {
  const src = read('references/cli.md');
  assert.match(src, /mod-secret\.sha256/);
  assert.doesNotMatch(src, /grant/i);
  assert.doesNotMatch(src, /rotat/i);
});

test('cli.md documents the heartbeat, the fix track, evidence phase, config keys, and mod commands', () => {
  const src = read('references/cli.md');
  for (const needle of [
    'mod-heartbeat',
    'epoch milliseconds',
    'modActive',
    'cairn repro',
    'cairn escalate',
    'repro → execute → review → ship → closed',
    'cairn evidence phase',
    'cairn-direction',
    'resumeFreshAfterMinutes',
    'fixMaxFiles',
    'reproTimeoutMinutes',
    'FR-32',
    'cairn-pane',
    'cairn-approve',
    'cairn-pause-now',
    'cairn-pause-mod',
    'cairn-resume-mod',
  ])
    assert.ok(src.includes(needle), `cli.md names ${needle}`);
  assert.match(src, /`setup`/);
});

test('phase-end.md calls the follow-up option Start clean', () => {
  const src = read('procedures/phase-end.md');
  assert.match(src, /Start clean/);
  assert.doesNotMatch(src, /Approve and start clean/);
});

test('fix.md offers the in-place reopen first, then escalate, then hold, and has no Follow-ups reference', () => {
  const src = read('procedures/fix.md');
  const fixIn = src.indexOf('Fix in place (Recommended when small)');
  const esc = src.indexOf('Escalate to a feature plan', fixIn);
  const hold = src.indexOf('Hold', esc);
  assert.ok(fixIn >= 0 && esc > fixIn && hold > esc, 'options in order');
  assert.match(src, /cairn task start fix/);
  assert.doesNotMatch(src, /Follow-ups/);
});

test('the README states the Claude Code version and names the fix lane, the pane, and the direction command', () => {
  const src = readFileSync(join(root, '..', '..', 'README.md'), 'utf8');
  assert.match(src, /Claude Code v2\.1\.287 or later/);
  assert.match(src, /\/cairn:fix/);
  assert.match(src, /pane/i);
  assert.match(src, /\/cairn:direction/);
});

test('hooks/NOTES.md records the session.start fan-out and the mod command naming', () => {
  const src = read('hooks/NOTES.md');
  for (const needle of ['register.tsx', 'one matcherless hook per event', '$.command.run', 'cairn-pause-now', 'cut turn']) assert.ok(src.includes(needle), `NOTES.md names ${needle}`);
});
