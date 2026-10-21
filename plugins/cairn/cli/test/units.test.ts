import assert from 'node:assert/strict';
import { test } from 'node:test';
import { globToRegex, matchesAny, scopesOverlap } from '../src/glob.ts';
import { parsePlan } from '../src/plan-parse.ts';
import { readySet } from '../src/ready.ts';
import { missingSections, uncheckedItems, sections } from '../src/sections.ts';
import { newState } from '../src/state.ts';
import { parseArgs } from '../src/main.ts';

const PRD = '## Functional requirements\n- FR-01 add\n- FR-02 remove\n- FR-03 list\n';
const plan = (yaml: string, extra = '') =>
  `## Goal\ng\n## Architecture\na\n## Global constraints\nc\n## Review focus\nr\n## Phases\n\`\`\`yaml cairn-tasks\n${yaml}\n\`\`\`\n${extra}`;

test('globs match and overlap conservatively', () => {
  assert.ok(globToRegex('src/**/*.ts').test('src/a/b/c.ts'));
  assert.ok(globToRegex('src/**/*.ts').test('src/c.ts'));
  assert.ok(!globToRegex('src/*.ts').test('src/a/c.ts'));
  assert.ok(matchesAny('src/cart/x.ts', ['src/cart']));
  assert.ok(scopesOverlap(['src/cart/**'], ['src/cart/x.ts']));
  assert.ok(!scopesOverlap(['src/cart/**'], ['src/tax/**']));
  assert.ok(scopesOverlap(['**/*.test.ts'], ['src/a.ts']), 'leading wildcard is treated as overlapping');
});

test('sections ignore headings inside fenced code', () => {
  const md = '## A\nx\n```\n## Not\n```\n## B\n- [ ] q1\n- [x] q2\n';
  assert.deepEqual([...sections(md).keys()], ['a', 'b']);
  assert.deepEqual(missingSections(md, ['A', 'C']), ['C']);
  assert.equal(uncheckedItems(sections(md).get('b')).length, 1);
});

test('plan parse: valid plan, coverage, deferred', () => {
  const y = `phases:
  - id: one
    name: One
    tasks:
      - { id: a, name: A, covers: [FR-01], scope: ["src/a/**"] }
      - { id: b, name: B, covers: [FR-02], scope: ["src/b/**"], blocked_by: [a], complexity: simple }`;
  const bad = parsePlan(plan(y), PRD);
  assert.match(bad.problems.join(), /FR-03/);
  const ok = parsePlan(plan(y, '## Deferred requirements\n- FR-03 later\n'), PRD);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.phases[0].tasks[1].complexity, 'simple');
});

test('plan parse: cycles, later-phase blockers, unknown ids, missing scope', () => {
  const y = `phases:
  - id: one
    tasks:
      - { id: a, covers: [FR-01], scope: ["x"], blocked_by: [b] }
      - { id: b, covers: [FR-02, FR-09], scope: ["y"], blocked_by: [a] }
      - { id: c, covers: [FR-03], scope: [], blocked_by: [d] }
  - id: two
    tasks:
      - { id: d, covers: [FR-03], scope: ["z"] }`;
  const p = parsePlan(plan(y), PRD).problems.join('\n');
  assert.match(p, /cycle/);
  assert.match(p, /later phase/);
  assert.match(p, /FR-09/);
  assert.match(p, /scope/);
});

test('ready set respects blockers, scope overlap, cap, and pause', () => {
  const s = newState('x', 'X', 'feature', 'sdlc/x', 'main');
  s.stage = 'execute';
  const sl = (id: string, scope: string[], blockedBy: string[] = []) => ({ id, name: id, covers: [], blockedBy, scope, complexity: 'standard' as const, status: 'pending' as const, fixRound: 0 });
  s.phases = [{ id: 'p', name: 'P', status: 'in_progress', tasks: [sl('a', ['src/a/**']), sl('b', ['src/a/b.ts']), sl('c', ['src/c/**']), sl('d', ['src/d/**'], ['a'])] }];
  let r = readySet(s, 3);
  assert.deepEqual(r.ready.map((x) => x.id), ['a', 'c']);
  assert.deepEqual(r.waiting.map((w) => w.task.id).sort(), ['b', 'd']);
  r = readySet(s, 1);
  assert.deepEqual(r.ready.map((x) => x.id), ['a']);
  s.paused = { at: '', mode: 'drain' };
  assert.equal(readySet(s, 3).ready.length, 0);
});

test('arg parsing', () => {
  const { pos, opts } = parseArgs(['decide', 'q?', 'a', '--why', 'because', '--json', '--note=x y']);
  assert.deepEqual(pos, ['decide', 'q?', 'a']);
  assert.equal(opts.why, 'because');
  assert.equal(opts.json, true);
  assert.equal(opts.note, 'x y');
});
