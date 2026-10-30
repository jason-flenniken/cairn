import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pluginRoot } from '../src/util.ts';

const root = pluginRoot();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('the Merge step runs merge-check before the push and merges the checked head', () => {
  const src = read('procedures/ship.md');
  const merge = src.slice(src.indexOf('## Merge (the last step'));
  const check = merge.indexOf('cairn merge-check');
  assert.ok(check >= 0 && check < merge.indexOf('Push the plan branch'), 'merge-check comes before the push');
  assert.match(merge, /--match-head-commit <sha>/);
  for (const why of ['Code changed after the approval', 'The base conflicts with the branch', 'Tests fail with the base merged in', 'The fetch failed'])
    assert.ok(merge.includes(why), why);
  assert.match(read('references/cli.md'), /`cairn merge-check \[--json\]`/);
  assert.match(merge, /bin\/cairn approve ship --human/);
  assert.match(merge, /not a task: it works on the plan branch/);
});

test('a plan waiting on the ship again is routed to the Merge step, from ship and from fix', () => {
  const check = read('procedures/ship.md').split('## 2.')[0];
  assert.match(check, /When `state\.reapprove` is set[^\n]*Merge section, step 1/);
  assert.match(read('procedures/fix.md'), /\(run `cairn merge-check`, push the plan branch/);
});

test('the fix record says where the bug came from, with cairn trace', () => {
  assert.match(read('procedures/fix.md'), /cairn trace <path>:<start>-<end>/);
  assert.match(read('templates/record-fix.md'), /^Introduced by: /m);
  assert.match(read('references/cli.md'), /`cairn trace <path>:<start>\[-<end>\]/);
});
