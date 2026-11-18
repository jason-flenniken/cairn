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

test('discover.md asks one batched round with a guess attached, and records everything else as Assumed', () => {
  assert.match(src, /why, why now, what success looks like, the binding constraint/);
  assert.match(src, /first and labelled "\(Recommended\)"/);
  assert.match(src, /top four at most, together, in one AskUserQuestion call/);
  assert.match(src, /cairn decide "Assumed: <question>"/);
  assert.match(src, /Nothing is asked before or after it/);
  // Exactly one place asks the user: the one round.
  assert.equal([...src.matchAll(/in one AskUserQuestion call/g)].length, 1);
  assert.doesNotMatch(src, /one at a time with AskUserQuestion|Ask one at a time/);
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

test('discover.md ends with a read-back card that lists the assumptions, with no second question', () => {
  for (const f of ['Outcome:', 'User:', 'Why now:', 'Success:', 'Constraint:', 'Out of scope:', 'Assumed (N):'])
    assert.ok(src.includes(f), f);
  assert.ok(src.indexOf('Read-back card') < src.indexOf('Advance'));
  const step7 = src.slice(src.indexOf('## 7. The one round and the read-back card'), src.indexOf('## 8.'));
  assert.match(step7, /with no question under it/);
  assert.match(step7, /the PRD will repeat every Assumed line/);
  assert.doesNotMatch(step7, /\[cairn:readback|Is this right\?/);
});

test('discover.md keeps the follow-up step and drops the old completeness wording', () => {
  assert.match(src, /## 2b\. Offer matching follow-ups/);
  assert.match(src, /cairn advance/);
  assert.doesNotMatch(src, /just enough|completeness/);
});
