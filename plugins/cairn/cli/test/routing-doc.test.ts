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

test('execute.md reviews per the Task review line, and the security floor still runs on a skipped task', () => {
  const src = read('procedures/execute.md');
  const step = section(src, '## 5.', '## 6.');
  assert.match(step, /`Task review:` line says `no`, skip the task-reviewer\. The next bullet still applies/);
  assert.match(step, /task-reviewer/);
  assert.doesNotMatch(src, /review it only if it is risky|review only risky|Not risky: go straight/i);
  assert.match(step, /`security-reviewer`[\s\S]*in parallel/);
  assert.match(step, /\$\{CLAUDE_PLUGIN_ROOT\}/);
});

test('execute.md routes labels: Critical and Required to a fix, Optional and Nit to suggest add, FYI shown once', () => {
  const src = read('procedures/execute.md');
  const step = section(src, '## 5.', '## 6.');
  assert.match(step, /Critical and Required: step 6/);
  assert.match(step, /Optional, Nit and pre-existing findings as follow-ups itself[^\n]*--from task-review/);
  assert.match(step, /--from security-review/);
  assert.match(step, /FYI: mention once[^\n]*Do not log/);
  assert.match(section(src, '## 6.', '## 7.'), /Critical and Required/);
});

test('review.md runs the branch and security reviewers in parallel with the same routing', () => {
  const src = read('procedures/review.md');
  assert.match(src, /in the same message[\s\S]*`branch-reviewer`[\s\S]*`security-reviewer`/);
  assert.match(src, /Optional, Nit and pre-existing finding as a follow-up itself[^\n]*--from branch-review/);
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
  assert.match(step, /Optional, Nit and pre-existing findings as follow-ups itself/);
  assert.doesNotMatch(src, /If it is not, run the repo's tests and record/);
  assert.match(src, /untrusted input, personal data/);
  assert.doesNotMatch(src, /state\.approvals\.ship|gh pr create|Merge it now/);
  assert.match(src, /cairn pr open/);
  assert.match(src, /Merge \(after the PR is open\)/);
  assert.ok(src.indexOf('cairn pr open') < src.lastIndexOf('cairn advance'), 'the pull request opens before the closing advance');
  assert.match(src, /task\/<slug>\/fix/);
  assert.match(src, /old branch names/);
  assert.match(src, /--no-worktree[^\n]*<repo folder>--fix/);
});

test('model-tiers.md lists the task reviewer by level and the security reviewer', () => {
  const src = read('references/model-tiers.md');
  assert.doesNotMatch(src, /risky tasks only/);
  assert.match(src, /\| task-reviewer \(Polished: every task; Standard: risky and complex tasks/);
  assert.match(src, /\| security-reviewer [^\n]*\| sonnet \|/);
});
