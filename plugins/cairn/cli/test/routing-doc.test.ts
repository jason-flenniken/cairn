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

test('execute.md reviews every task and has no risky-only review branch', () => {
  const src = read('procedures/execute.md');
  const step = section(src, '## 5.', '## 6.');
  assert.match(step, /review every task/);
  assert.match(step, /task-reviewer/);
  assert.doesNotMatch(src, /review it only if it is risky|review only risky|Not risky: go straight/i);
  assert.match(step, /`security-reviewer`[\s\S]*in parallel/);
  assert.match(step, /\$\{CLAUDE_PLUGIN_ROOT\}/);
});

test('execute.md routes labels: Critical and Required to a fix, Optional and Nit to suggest add, FYI shown once', () => {
  const src = read('procedures/execute.md');
  const step = section(src, '## 5.', '## 6.');
  assert.match(step, /Critical and Required: step 6/);
  assert.match(step, /Optional and Nit:[^\n]*cairn suggest add[^\n]*--from task-review/);
  assert.match(step, /--from security-review/);
  assert.match(step, /FYI: mention once[^\n]*Do not log/);
  assert.match(section(src, '## 6.', '## 7.'), /Critical and Required/);
});

test('review.md runs the branch and security reviewers in parallel with the same routing', () => {
  const src = read('procedures/review.md');
  assert.match(src, /in the same message[\s\S]*`branch-reviewer`[\s\S]*`security-reviewer`/);
  assert.match(src, /Optional or Nit[^\n]*cairn suggest add[^\n]*--from branch-review/);
  assert.match(src, /--from security-review/);
  assert.match(src, /FYI/);
  assert.match(src, /Critical or Required/);
});

test('fix.md reviews every fix, names the wider risky list, merges before close, and matches FR-21', () => {
  const src = read('procedures/fix.md');
  const step = section(src, '## 6. Review', '## 7.');
  assert.match(step, /Every fix is reviewed, risky or not/);
  assert.match(step, /task-reviewer/);
  assert.match(step, /security-reviewer/);
  assert.match(step, /untrusted input, personal data, a new dependency, model output, or shell commands and paths built from data/);
  assert.match(step, /Optional and Nit[^\n]*cairn suggest add/);
  assert.doesNotMatch(src, /If it is not, run the repo's tests and record/);
  assert.match(src, /untrusted input, personal data/);
  assert.match(src, /state\.approvals\.ship[^\n]*already recorded/);
  assert.match(src, /gh pr create/);
  assert.match(src, /Merge it now \(Recommended\)/);
  assert.ok(src.indexOf('Merge it now') < src.lastIndexOf('`cairn advance`'), 'merge question comes before the closing advance');
  assert.match(src, /task\/<slug>\/fix/);
  assert.match(src, /old branch names/);
  assert.match(src, /--no-worktree[^\n]*<repo folder>--fix/);
});

test('model-tiers.md lists the task reviewer for every task and the security reviewer', () => {
  const src = read('references/model-tiers.md');
  assert.doesNotMatch(src, /risky tasks only/);
  assert.match(src, /\| task-reviewer \(every task\) \| sonnet \|/);
  assert.match(src, /\| security-reviewer [^\n]*\| sonnet \|/);
});
