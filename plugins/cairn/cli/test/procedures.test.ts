import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pluginRoot } from '../src/util.ts';

const root = pluginRoot();
const procedureDir = join(root, 'procedures');
const read = (name: string) => readFileSync(join(procedureDir, `${name}.md`), 'utf8');
const allProcedures = readdirSync(procedureDir)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.slice(0, -3));

// Each procedure with an approval menu, and the kinds its tags may name.
// Phase end approves a phase, and its fix-first and re-plan branches approve a plan.
const APPROVALS: Record<string, string[]> = {
  prd: ['prd'],
  plan: ['plan'],
  ship: ['ship'],
  verify: ['plan'],
  review: ['plan'],
  'phase-end': ['phase', 'plan'],
};

// Option labels that must not sit between an approval tag and its "Approve (Recommended)".
const OTHER_LABELS = ['Revise', 'Hold', 'Pause', 'Fix', 'Continue', 'Override'];

test('each approval procedure has its tagged menu, Approve (Recommended) first, and the --human fallback', () => {
  for (const [name, kinds] of Object.entries(APPROVALS)) {
    const src = read(name);
    const tags = [...src.matchAll(/\[cairn:approve (\w+) <slug>\]/g)];
    assert.ok(tags.length > 0, `${name}: has an approval tag`);
    for (const kind of kinds)
      assert.ok(tags.some((t) => t[1] === kind), `${name}: has a tag for ${kind}`);
    for (const tag of tags) {
      assert.ok(kinds.includes(tag[1]), `${name}: tag kind "${tag[1]}" matches the procedure`);
      const after = src.slice(tag.index + tag[0].length);
      const approve = after.indexOf('Approve (Recommended)');
      assert.ok(approve >= 0, `${name}: Approve (Recommended) follows the tag`);
      const before = after.slice(0, approve);
      for (const label of OTHER_LABELS)
        assert.ok(!new RegExp(`\\b${label}\\b`).test(before), `${name}: "${label}" comes before Approve (Recommended)`);
    }
    for (const kind of kinds)
      assert.match(src, new RegExp(`cairn approve ${kind} --human`), `${name}: --human fallback for ${kind}`);
    assert.match(src, /modActive/, `${name}: checks modActive`);
  }
});

test('no procedure runs cairn approve outside the --human fallback', () => {
  for (const name of allProcedures) {
    for (const line of read(name).split('\n')) {
      if (!line.includes('cairn approve ')) continue;
      assert.ok(line.includes('--human'), `${name}: "${line.trim()}"`);
    }
  }
});

test('every step that passes --override also has an Override menu', () => {
  for (const name of allProcedures) {
    // A step is a block of text between blank lines.
    for (const step of read(name).split(/\n\s*\n/)) {
      if (!step.includes('--override')) continue;
      assert.ok(step.includes('[cairn:override '), `${name}: "${step.trim().slice(0, 60)}" needs a [cairn:override <slug>] menu`);
      assert.ok(step.includes('"Override"'), `${name}: the menu needs an option labeled "Override"`);
    }
  }
});
