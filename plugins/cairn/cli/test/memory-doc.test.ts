import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pluginRoot } from '../src/util.ts';

const root = pluginRoot();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const has = (file: string, ...phrases: string[]) => {
  const src = read(file);
  for (const p of phrases) assert.ok(src.includes(p), `${file} is missing "${p}"`);
};

test('ship and fix update area docs from recall and promote lasting decisions', () => {
  has('procedures/ship.md', 'cairn recall', 'templates/area.md', '--promote');
  has('procedures/fix.md', 'cairn recall', 'templates/area.md', '--promote');
});

test('learn names cairn area skip for close refusals', () => {
  has('procedures/learn.md', 'cairn area skip');
});

test('discover, plan, execute, and review run cairn recall', () => {
  for (const f of ['discover', 'plan', 'execute', 'review']) has(`procedures/${f}.md`, 'cairn recall');
  assert.ok(!read('procedures/discover.md').includes('prior work in'));
  has('procedures/discover.md', 'cairn index', '--lasting', '--replaces');
  has('procedures/execute.md', 'What to respect');
});

test('reviewers treat contradicting a decision in force as a finding', () => {
  for (const f of ['task-reviewer', 'branch-reviewer']) has(`agents/${f}.md`, 'decision in force', '--replaces');
  has('references/review-checklist.md', 'Contradicts a decision in force (from cairn recall)');
});

test('implementer and recorder know the memory', () => {
  has('agents/implementer.md', 'What to respect');
  has('agents/recorder.md', '## Area docs', '## History', 'never');
});

test('cli.md documents the memory commands', () => {
  has('references/cli.md', 'cairn recall', 'cairn index', 'cairn area skip', '--lasting', 'OVERVIEW.md');
});

test('README has a Project memory section', () => {
  const src = readFileSync(join(root, '..', '..', 'README.md'), 'utf8');
  assert.match(src, /^## Project memory/m);
  assert.ok(src.includes('cairn recall'));
});
