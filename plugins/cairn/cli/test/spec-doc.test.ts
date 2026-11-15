import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pluginRoot } from '../src/util.ts';

const root = pluginRoot();
const read = (p: string) => readFileSync(join(root, p), 'utf8');
/** Text of one section: from its `## ` heading up to the next one. */
const block = (src: string, heading: string) => {
  const s = src.split(/^(?=## )/m).find((x) => x.startsWith(heading));
  assert.ok(s, `missing section ${heading}`);
  return s;
};

test('new: a bare Linear selection needs no flag, and specced tickets get one choice', () => {
  const src = read('procedures/new.md');
  const step2 = block(src, '## 2. Title and slug');
  assert.match(step2, /Arguments that are only a Linear selection mean the same thing with no flag/);
  assert.match(step2, /Treat them as `--from-linear <selection>`/);
  assert.match(step2, /ask the user whether it is a Linear issue/, 'a bare key with no Linear config is confirmed first');
  const step5a = block(src, '## 5a.');
  assert.match(step5a, /`data\.spec\.ok` is true/);
  assert.match(step5a, /Build from the tickets \(Recommended\)/);
  assert.match(step5a, /Run the full discover/);
  assert.match(step5a, /cairn decide "Spec from tickets"/);
  assert.match(read('skills/new/SKILL.md'), /with or without `--from-linear` in front/);
});

test('discover: the ticket path is taken only on the user\'s choice and skips the interview', () => {
  const src = read('procedures/discover.md');
  const step = block(src, '## 1a. Built from the tickets');
  assert.ok(src.indexOf('## 1. Check') < src.indexOf('## 1a.') && src.indexOf('## 1a.') < src.indexOf('## 2. Research first'));
  assert.match(step, /`state\.linear\.spec\.ok`/);
  assert.match(step, /"Spec from tickets" as "Build from the tickets"/);
  assert.match(step, /skip steps 2 to 7/);
  assert.match(step, /cairn decide "Not taken: <KEY>"/);
  assert.match(step, /cairn decide "Outside blocker: <KEY>"/);
  assert.match(step, /`## Decisions`/);
  // The full discover is unchanged for every other plan.
  for (const h of ['## 2. Research first', '## 3. Guess and confidence', '## 4. Goal questions', '## 4b. Fresh-eyes challenge', '## 7. Read-back card']) assert.ok(src.includes(h), h);
});

test('prd: specced tickets are rendered by the CLI, the builder check and approval stay', () => {
  const src = read('procedures/prd.md');
  const step = block(src, '## 1a. From the tickets');
  assert.match(step, /cairn linear prd/);
  assert.match(step, /Skip step 2\. Step 2b runs as written/);
  assert.match(step, /keep every requirement's `\[KEY\]` tag/);
  assert.ok(src.includes('## 2. Brief the writer') && src.includes('## 3. Stop for approval'));
});

test('spec: two modes picked by the arguments, one approval before any write, nothing lost on convert', () => {
  const src = read('procedures/spec.md');
  assert.match(src, /\*\*Create\*\*: from a brainstorm/);
  assert.match(src, /\*\*Convert\*\*: from tickets already in Linear/);
  assert.match(block(src, '## 2b.'), /An epic is converted unless it is `completed` or `canceled` itself/);
  assert.match(block(src, '## 3. Shape the tree'), /decision or human issue .* sitting under an epic/);
  assert.match(block(src, '## 4. Approve the tree'), /nothing is written to Linear before it/);
  const write = block(src, '## 5. Write to Linear');
  assert.match(write, /`addLabels`, never `labels`/);
  assert.match(write, /`\+\+\+ Original`/);
  assert.match(write, /Never change a ticket's status, assignee, priority or estimate/);
  const contract = read('references/linear-tickets.md');
  for (const h of ['## Goal', '## In scope', '## Out of scope', '## Done when', '## What']) assert.ok(contract.includes(h), h);
  assert.match(contract, /\*\*`cairn-spec`\*\*/);
});
