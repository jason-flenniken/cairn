import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pluginRoot } from '../src/util.ts';

const root = pluginRoot();
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const section = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `${from} .. ${to} present`);
  return src.slice(a, b);
};

test('review-checklist.md reads REVIEW.md and defines pre-existing, class, reachable paths and Not checked', () => {
  const src = read('references/review-checklist.md');
  assert.match(src, /^## Project rules/m);
  assert.match(src, /`REVIEW\.md`/);
  assert.match(src, /^### Pre-existing/m);
  assert.match(src, /^### Class/m);
  assert.match(src, /No reachable path: drop it/);
  assert.match(src, /weakened test/);
  assert.match(src, /docs that lie/);
  assert.match(src, /^Counts:/m);
  assert.match(src, /^Not checked:/m);
});

test('every reviewer emits a class, the pre-existing marker and a Not checked line', () => {
  for (const f of ['agents/task-reviewer.md', 'agents/branch-reviewer.md', 'agents/security-reviewer.md']) {
    const src = read(f);
    assert.match(src, /\[ pre-existing\] \| [^\n]*\| <class> \| path:line/, f);
    assert.match(src, /^Not checked:/m, f);
    assert.match(src, /REVIEW\.md|review-checklist\.md/, f);
  }
});

test('the task reviewer gets the test line, never the implementer report', () => {
  const step = section(read('procedures/execute.md'), '## 5.', '## 6.');
  assert.match(step, /the `Tests:` line from the implementer's report/);
  assert.match(step, /Never pass the rest of the report/);
  assert.match(step, /Pre-existing, at any label[^\n]*never send it to step 6/);
  assert.match(read('agents/task-reviewer.md'), /never get the implementer's account/);
  assert.match(section(read('procedures/execute.md'), '## 6.', '## 7.'), /fix each class everywhere/);
});

test('the branch review gets an already-reported list and fixes by class', () => {
  const src = read('procedures/review.md');
  assert.match(section(src, '## 2.', '## 3.'), /already-reported list/);
  assert.match(section(src, '## 3.', '## 4.'), /pre-existing finding/);
  assert.match(section(src, '## 4.', '## 5.'), /fix each class everywhere/);
});

test('ship drafts review rules and asks about them apart from the approval', () => {
  const src = read('procedures/ship.md');
  const draft = section(src, '## 3b. Propose review rules', '## 4.');
  assert.match(draft, /at most 3 rules/);
  const confirm = section(src, '## 5. Confirm', '## 6.');
  assert.match(confirm, /never inside the approval question/);
  assert.match(confirm, /`multiSelect: true`/);
  assert.match(confirm, /## Rules learned/);
  assert.match(confirm, /templates\/review\.md/);
  assert.match(read('procedures/fix.md'), /step 3b of `procedures\/ship\.md`/);
});

test('the REVIEW.md template has the sections reviewers rely on', () => {
  const src = read('templates/review.md');
  for (const h of ['What failure looks like here', 'Always check', 'Skip', 'Nits', 'Rules learned']) {
    assert.match(src, new RegExp(`^## ${h}$`, 'm'), h);
  }
});

test('records say how to revert the change', () => {
  for (const f of ['templates/record.md', 'templates/record-fix.md']) {
    assert.match(read(f), /^- Revert: /m, f);
  }
  assert.match(read('agents/recorder.md'), /Revert/);
});
