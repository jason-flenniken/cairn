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
  assert.match(src, /git show <base>:REVIEW\.md/);
  assert.match(src, /never rules to apply/);
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
  assert.match(step, /the implementer's report for its `Tests:` line/);
  assert.match(step, /Never tell the reviewer to read the rest of the report/);
  assert.match(step, /`Concerns \/ questions:` line when the status is `DONE_WITH_CONCERNS`/);
  assert.match(step, /pre-existing finding, at any label[^\n]*never sent to step 6/);
  assert.match(read('agents/task-reviewer.md'), /never read the implementer's account/);
  const fix = section(read('procedures/execute.md'), '## 6.', '## 7.');
  assert.match(fix, /fix each class everywhere/);
  assert.match(fix, /records the fix attempt itself[^\n]*classes of the findings in its note/);
});

test('the branch review gets an already-reported list and fixes by class', () => {
  const src = read('procedures/review.md');
  assert.match(section(src, '## 2.', '## 3.'), /already-reported list/);
  assert.match(section(src, '## 3.', '## 4.'), /pre-existing finding/);
  assert.match(section(src, '## 4.', '## 5.'), /fix each class everywhere/);
  assert.match(src.slice(src.indexOf('## 5.')), /Pre-existing findings never count here[\s\S]*fixed classes:/);
  assert.match(src, /MVP:[^\n]*every pre-existing finding as hardening items/);
});

test('ship drafts review rules from the plan log and lists them in the record, without asking', () => {
  const src = read('procedures/ship.md');
  const rules = section(src, '## 2a. Propose review rules', '## 3.');
  assert.match(rules, /Draft at most 3/);
  assert.match(rules, /`fixing classes:`/);
  assert.match(rules, /not the ones you dismissed while tidying in step 2/);
  assert.match(rules, /Do not ask about them and do not edit `REVIEW\.md`/);
  assert.match(rules, /Proposed review rule:/);
  assert.match(rules, /## Rules learned/);
  assert.doesNotMatch(rules, /AskUserQuestion|multiSelect/);
  assert.match(read('procedures/fix.md'), /step 2a of `procedures\/ship\.md`, with one more source: the bug itself/);
  assert.match(read('procedures/fix.md'), /other than pre-existing ones/);
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
