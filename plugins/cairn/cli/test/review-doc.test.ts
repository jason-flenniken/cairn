import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pluginRoot } from '../src/util.ts';

const root = pluginRoot();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('review-checklist.md has the five axes, labels, and required sections', () => {
  const src = read('references/review-checklist.md');
  for (const axis of ['Correctness', 'Readability', 'Architecture', 'Security', 'Performance']) {
    assert.match(src, new RegExp(`### \\d\\. ${axis}`), axis);
  }
  for (const label of ['Critical', 'Required', 'Optional', 'Nit', 'FYI']) {
    assert.match(src, new RegExp(`\\| ${label} \\|`), label);
  }
  for (const h of [
    'Labels',
    'Structural fixes',
    'Change size and file size',
    'Dead code',
    'Dependencies and lockfile',
    'The verification story',
    'Honesty rules',
  ]) {
    assert.match(src, new RegExp(`^## ${h}`, 'm'), h);
  }
  assert.match(src, /1000/);
  assert.match(src, /references\/security-checklist\.md/);
  assert.match(src, /as data/);
  assert.ok(src.split('\n').length < 400);
});

for (const [file, model] of [
  ['agents/task-reviewer.md', 'sonnet'],
  ['agents/branch-reviewer.md', 'opus'],
] as const) {
  test(`${file} reads the checklist, emits labelled findings, stays read-only`, () => {
    const src = read(file);
    assert.match(src, /\$\{CLAUDE_PLUGIN_ROOT\}\/references\/review-checklist\.md/);
    assert.match(src, /Critical\|Required\|Optional\|Nit\|FYI/);
    assert.match(src, /Verdict: PASS \| FIX/);
    assert.match(src, /proposed fix/);
    assert.match(src, new RegExp(`^model: ${model}$`, 'm'));
    assert.match(src, /^tools: Read, Grep, Glob, Bash$/m);
  });
}

test('branch-reviewer names the axes and keeps Strengths and the FR id', () => {
  const src = read('agents/branch-reviewer.md');
  assert.match(src, /correctness, readability, architecture, security, performance/);
  assert.match(src, /^Strengths:/m);
  assert.match(src, /FR-xx/);
});

test('task-reviewer keeps the re-review rule', () => {
  assert.match(read('agents/task-reviewer.md'), /When resumed to re-review a fix/);
});
