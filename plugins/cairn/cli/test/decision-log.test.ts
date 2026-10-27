import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { activeDecisionsFor, DECISIONS_DIR, decisionId, loadDecisions, publishDecisions } from '../src/decision-log.ts';
import type { PendingDecision } from '../src/types.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'cairn-decisions-'));
const pend = (over: Partial<PendingDecision> = {}): PendingDecision => ({
  n: 1,
  question: 'How should plan branches be named?',
  answer: 'feature/<slug>',
  why: 'One name per plan.',
  areas: ['locate'],
  paths: ['src/locate.ts'],
  at: '2026-10-21T10:00:00Z',
  ...over,
});

test('decisionId slugs the question and avoids taken ids', () => {
  const q = 'How should plan branches be named?';
  assert.equal(decisionId('2026-10-21', q, new Set()), '2026-10-21-how-should-plan-branches-be-named');
  assert.equal(decisionId('2026-10-21', q, new Set(['2026-10-21-how-should-plan-branches-be-named'])), '2026-10-21-how-should-plan-branches-be-named-2');
});

test('publish then load round-trips', () => {
  const root = tmp();
  const [file] = publishDecisions(root, '2026-10-21-demo', '2026-10-21', [pend()]);
  const id = '2026-10-21-how-should-plan-branches-be-named';
  assert.equal(file, `${DECISIONS_DIR}/${id}.md`);
  assert.deepEqual(loadDecisions(root), [
    {
      id,
      question: 'How should plan branches be named?',
      answer: 'feature/<slug>',
      why: 'One name per plan.',
      status: 'active',
      replacedBy: undefined,
      replaces: undefined,
      areas: ['locate'],
      paths: ['src/locate.ts'],
      plan: '2026-10-21-demo',
      date: '2026-10-21',
      file,
    },
  ]);
});

test('replaces marks the old one', () => {
  const root = tmp();
  const [fa] = publishDecisions(root, 'p1', '2026-10-21', [pend()]);
  const before = readFileSync(join(root, fa), 'utf8').split('\n---\n')[1];
  const a = loadDecisions(root)[0];
  const written = publishDecisions(root, 'p2', '2026-10-22', [pend({ question: 'Name plan branches how?', answer: 'plan/<slug>', replaces: a.id })]);
  assert.equal(written.length, 2);
  const all = loadDecisions(root);
  const old = all.find((d) => d.id === a.id)!;
  const next = all.find((d) => d.id !== a.id)!;
  assert.equal(old.status, 'replaced');
  assert.equal(old.replacedBy, next.id);
  assert.equal(next.status, 'active');
  assert.equal(next.replaces, a.id);
  assert.equal(readFileSync(join(root, fa), 'utf8').split('\n---\n')[1], before);
});

test('activeDecisionsFor matches by path overlap or area id and skips replaced', () => {
  const root = tmp();
  publishDecisions(root, 'p1', '2026-10-21', [pend()]);
  const all = loadDecisions(root);
  assert.equal(activeDecisionsFor(['src/locate.ts'], [], all).length, 1);
  assert.equal(activeDecisionsFor([], ['locate'], all).length, 1);
  assert.equal(activeDecisionsFor(['other/x.ts'], ['state'], all).length, 0);
  assert.equal(activeDecisionsFor(['src/locate.ts'], ['locate'], all.map((d) => ({ ...d, status: 'replaced' as const }))).length, 0);
});

test('loadDecisions skips a malformed file', () => {
  const root = tmp();
  publishDecisions(root, 'p1', '2026-10-21', [pend()]);
  writeFileSync(join(root, DECISIONS_DIR, 'junk.md'), '# no frontmatter here\n');
  assert.equal(loadDecisions(root).length, 1);
});

test('publishing the same pending list twice writes once and returns [] the second time', () => {
  const root = tmp();
  const list = [pend()];
  assert.equal(publishDecisions(root, 'p1', '2026-10-21', list).length, 1);
  assert.deepEqual(publishDecisions(root, 'p1', '2026-10-21', list), []);
  assert.equal(readdirSync(join(root, DECISIONS_DIR)).length, 1);
});
