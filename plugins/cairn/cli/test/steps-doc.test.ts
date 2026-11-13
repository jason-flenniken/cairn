import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { STEPS } from '../src/types.ts';
import { pluginRoot } from '../src/util.ts';

const root = pluginRoot();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

// FR-10: each procedure runs `cairn step <name>` at every step its stage has.
const PROCEDURES: Record<string, string[]> = {
  'procedures/prd.md': [...STEPS.prd!],
  'procedures/plan.md': [...STEPS.plan!],
  'procedures/verify.md': [...STEPS.verify!],
  'procedures/review.md': [...STEPS.review!],
  'procedures/ship.md': [...STEPS.ship!],
  // The fix track goes through review and ship; it has no verify stage.
  'procedures/fix.md': ['reviewing', 'rechecking', 'recording', 'approving', 'opening-pr', 'asking'],
};

for (const [file, names] of Object.entries(PROCEDURES)) {
  test(`${file} runs cairn step for ${names.join(', ')}`, () => {
    const src = read(file);
    for (const name of names) {
      assert.match(src, new RegExp(`cd <plan worktree> && cairn step ${name}\\b`), name);
    }
  });
}

test('fixing steps pass the finding count', () => {
  for (const file of ['procedures/verify.md', 'procedures/review.md']) {
    assert.match(read(file), /cairn step fixing --count N/, file);
  }
});

test('procedures that ask a blocking question run cairn step asking, and say how it ends', () => {
  for (const file of ['execute', 'phase-end', 'discover']) {
    const src = read(`procedures/${file}.md`);
    assert.match(src, /cd <plan worktree> && cairn step asking/, file);
    assert.match(src, /cd <plan worktree> && cairn step clear/, file);
  }
});
