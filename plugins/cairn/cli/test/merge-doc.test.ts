import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pluginRoot } from '../src/util.ts';

const root = pluginRoot();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('the Merge step runs merge-check before the push and merges the checked head', () => {
  const src = read('procedures/ship.md');
  const merge = src.slice(src.indexOf('## Merge (after the PR is open)'));
  const check = merge.indexOf('cairn merge-check');
  assert.ok(check >= 0 && check < merge.indexOf('Push the plan branch'), 'merge-check comes before the push');
  assert.match(merge, /--match-head-commit <sha>/);
  for (const why of ['The base conflicts with the branch', 'Tests fail with the base merged in', 'The fetch failed'])
    assert.ok(merge.includes(why), why);
  assert.doesNotMatch(merge, /Code changed after the approval|approve ship/);
  assert.match(read('references/cli.md'), /`cairn merge-check \[--json\]`/);
  assert.match(merge, /not a task: it works on the plan branch/);
});

test('ship ends its turn on the pull request, and fix and ship send the user to the Merge section', () => {
  const ship = read('procedures/ship.md');
  assert.match(ship, /cairn advance/);
  assert.doesNotMatch(ship, /step waiting/);
  assert.match(read('procedures/learn.md'), /Reply merge to merge it, or send notes/);
  assert.match(ship, /never write the body by hand|Never write the body by hand/);
  assert.match(ship, /follow-on plan/);
  assert.match(read('procedures/fix.md'), /"Merge \(after the PR is open\)" section of `procedures\/ship\.md`/);
  assert.match(read('procedures/learn.md'), /"Merge \(after the PR is open\)" section of `procedures\/ship\.md`/);
});

test('the fix record says where the bug came from, with cairn trace', () => {
  assert.match(read('procedures/fix.md'), /cairn trace <path>:<start>-<end>/);
  assert.match(read('templates/record-fix.md'), /^Introduced by: /m);
  assert.match(read('references/cli.md'), /`cairn trace <path>:<start>\[-<end>\]/);
});
