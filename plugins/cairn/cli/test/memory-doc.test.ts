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

test('map skill and procedure bootstrap area docs and the decision log', () => {
  has('skills/map/SKILL.md', 'procedures/map.md', 'Bash(cairn render:*)', 'Bash(cairn migrate:*)');
  const src = read('procedures/map.md');
  for (let n = 1; n <= 6; n++) assert.match(src, new RegExp(`^## ${n}\\. `, 'm'), `map.md is missing step ${n}`);
  has('procedures/map.md', 'templates/area.md', 'cairn decide', '--lasting', 'cairn render', 'cairn recall', 'AskUserQuestion', 'Record · area');
});

test('area template and recorder keep summary and updated quoted, and only RECORD.md has a word cap', () => {
  has('templates/area.md', 'summary: "', 'updated: "');
  has('agents/recorder.md', 'double quotes', 'For RECORD.md: run `wc -w`', 'Area docs have no word cap');
});

test('replace instructions give the full decide form', () => {
  const full = 'cairn decide "<question>" "<answer>" --why "…" --lasting --replaces <id>';
  for (const f of ['agents/task-reviewer.md', 'agents/branch-reviewer.md', 'procedures/plan.md', 'procedures/discover.md']) has(f, full);
  has('references/cli.md', 'inherits the replaced one');
});

test('new treats the legacy config as present, and the README explains upgrading', () => {
  has('procedures/new.md', '.sdlc/config.json', 'cairn migrate');
  const src = readFileSync(join(root, '..', '..', 'README.md'), 'utf8');
  assert.match(src, /^### Upgrading from 0\.5/m);
  assert.ok(src.includes('cairn migrate'));
});

test('ship and fix skip only the recorder without area docs, and promote from the plan worktree', () => {
  for (const f of ['procedures/ship.md', 'procedures/fix.md']) has(f, 'skip the recorder dispatch', 'cd <plan worktree> && cairn decide --promote');
});

test('map checks for a plan with cairn next, not status', () => {
  has('procedures/map.md', 'cairn next --json');
  assert.ok(!read('procedures/map.md').includes('cairn status --json'));
});
