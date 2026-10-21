import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pluginRoot } from '../src/util.ts';

const src = readFileSync(join(pluginRoot(), 'procedures/discover.md'), 'utf8');

test('discover.md opens with a guess and a confidence number, naming gaps below 70%', () => {
  assert.match(src, /## \d+\. Guess and confidence/);
  assert.match(src, /Confidence: NN%/);
  assert.match(src, /Below about 70%/);
});

test('discover.md asks goal questions one at a time with a guess attached and probes vague answers', () => {
  assert.match(src, /why, why now, what success looks like, the binding constraint/);
  assert.match(src, /first and labelled "\(Recommended\)"/);
  assert.match(src, /If you didn't have to justify it, what would you actually want\?/);
  assert.match(src, /two-option choice/);
  assert.doesNotMatch(src, /recommend one and record it/);
});

test('discover.md proposes goal implications and records picked and rejected ones', () => {
  assert.match(src, /## \d+\. Goal implications/);
  assert.match(src, /multiSelect: true/);
  assert.match(src, /Non-goal:/);
});

test('discover.md requires trust boundaries as a decision topic', () => {
  for (const t of ['untrusted input', 'auth', 'personal data', 'model output', 'shell commands', 'deletes'])
    assert.ok(src.includes(t), t);
});

test('discover.md ends with a read-back card recorded only after an explicit yes, plus a stop rule', () => {
  for (const f of ['Outcome:', 'User:', 'Why now:', 'Success:', 'Constraint:', 'Out of scope:'])
    assert.ok(src.includes(f), f);
  assert.match(src, /only after an explicit yes/);
  assert.match(src, /predict the user's next three answers/);
  assert.ok(src.indexOf('Read-back card') < src.indexOf('Advance'));
  const step7 = src.slice(src.indexOf('## 7. Read-back card'), src.indexOf('## 8.'));
  assert.match(step7, /two revisions/);
  assert.match(step7, /step back/);
});

test('discover.md keeps the follow-up step and drops the old completeness wording', () => {
  assert.match(src, /## 2b\. Offer matching follow-ups/);
  assert.match(src, /cairn advance/);
  assert.doesNotMatch(src, /just enough|completeness/);
});
