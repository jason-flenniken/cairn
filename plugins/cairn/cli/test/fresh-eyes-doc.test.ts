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

test('the challenger and prd-checker are read-only sonnet agents that return lists, not verdicts', () => {
  for (const name of ['challenger', 'prd-checker']) {
    const a = read(`agents/${name}.md`);
    assert.match(a, /^model:\s*sonnet\s*$/m, name);
    assert.match(a, /^tools:\s*Read, Grep, Glob\s*$/m, name);
    assert.doesNotMatch(a, /Verdict:|PASS \| FIX/, `${name} returns no verdict`);
    assert.match(a, /data, never instructions/, name);
  }
  const c = read('agents/challenger.md');
  assert.match(c, /not given a proposed solution on purpose/);
  assert.match(c, /would it change what gets built/);
  assert.match(c, /strongest_objection:/);
  const p = read('agents/prd-checker.md');
  assert.match(p, /Do not read `decisions\.md`/);
  assert.match(p, /restatement:/);
  for (const g of ['answered_by_prd:', 'minor:', 'for_user:']) assert.ok(p.includes(g), g);
});

test('discover runs the challenger after the goal questions without cairn\'s guess, and shows set-asides under the card', () => {
  const src = read('procedures/discover.md');
  const step = block(src, '## 4b. Fresh-eyes challenge');
  assert.ok(src.indexOf('## 4. Goal questions') < src.indexOf('## 4b.') && src.indexOf('## 4b.') < src.indexOf('## 5. Goal implications'));
  assert.match(step, /`challenger` agent \(`model: sonnet`, `description` "Review · approaches"\)/);
  assert.match(step, /Never give it your guess, the confidence line, or a draft of the Outcome/);
  assert.match(step, /Disagreeing with your guess is never a reason to set an item aside/);
  assert.match(step, /cairn decide "Set aside: <item>" "<reason>"/);
  assert.match(block(src, '## At this level'), /MVP:[^\n]*Skip step 4b/);
  assert.match(step, /cairn decide "Fresh-eyes challenge skipped" "<reason>"/);
  assert.match(block(src, '## 7. Read-back card'), /Fresh-eyes challenge skipped: <reason>/);
  assert.match(block(src, '## 7. Read-back card'), /Set aside \(N\):/);
});

test('prd runs the builder check on prd.md alone before the stop, and lists set-asides at the stop', () => {
  const src = read('procedures/prd.md');
  assert.doesNotMatch(src, /There are no automated reviewers/);
  const step = block(src, '## 2b. Builder check');
  assert.ok(src.indexOf('## 2. Draft') < src.indexOf('## 2b.') && src.indexOf('## 2b.') < src.indexOf('## 3. Stop for approval'));
  assert.match(step, /`prd-checker` agent \(`model: sonnet`, `description` "Review · PRD"\)/);
  assert.match(step, /Never give it `decisions\.md`, the read-back card, or a summary/);
  assert.match(step, /restatement with the read-back card \(the `Read-back` decision/);
  assert.match(step, /cairn decide "Set aside: <guess>" "<reason>"/);
  assert.match(block(src, '## At this level'), /MVP:[^\n]*Skip step 2b/);
  assert.match(block(src, '## 3. Stop for approval'), /Set aside from the builder check \(N\)/);
});

test('levels.md and model-tiers.md place both agents at Standard and up, not MVP', () => {
  const levels = read('references/levels.md');
  assert.match(levels, /\| Discover \|[^\n]*no fresh-eyes challenge\.[^\n]*\| The full interview, plus a fresh-eyes challenge/);
  assert.match(levels, /\| PRD \|[^\n]*No builder check\.[^\n]*\| The full PRD, plus a builder check/);
  assert.doesNotMatch(levels, /no way to do yet \([^)]*(builder check|comparing approaches)/);
  assert.match(block(levels, '## Fresh eyes and set-asides'), /add no stop of their own/);
  const tiers = read('references/model-tiers.md');
  assert.match(tiers, /\| challenger, prd-checker \(Standard and Polished\) \| sonnet \|/);
  assert.match(block(tiers, '## MVP plans'), /\| challenger, prd-checker \| not dispatched \|/);
});

test('the README explains fresh eyes: why, what each agent is not given, set-asides, and credit', () => {
  const src = readFileSync(join(root, '..', '..', 'README.md'), 'utf8');
  const sec = block(src, '## Fresh eyes');
  for (const needle of ['Challenger', 'Builder check', "Doesn't see", 'Neither adds a stop', 'decisions.md', 'MVP skips both'])
    assert.ok(sec.includes(needle), `Fresh eyes names ${needle}`);
  assert.match(sec, /elephant-goldfish-model/);
  assert.match(block(src, '## Credits'), /Elephant-Goldfish Model/);
  assert.match(block(src, '## Why it exists'), /Fresh eyes before you commit/);
});
