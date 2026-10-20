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

// Each procedure with an approval menu, and the kind its tag must name.
const APPROVALS: Record<string, string> = {
  prd: 'prd',
  plan: 'plan',
  ship: 'ship',
  verify: 'plan',
  review: 'plan',
  'phase-end': 'phase',
};

test('each approval procedure has its tagged menu and the --human fallback', () => {
  for (const [name, kind] of Object.entries(APPROVALS)) {
    const src = read(name);
    assert.ok(src.includes(`[cairn:approve ${kind} <slug>]`), `${name}: tag for ${kind}`);
    assert.match(src, new RegExp(`cairn approve ${kind} --human`), `${name}: --human fallback`);
    assert.match(src, /modActive/, `${name}: checks modActive`);
    assert.ok(src.includes('Approve (Recommended)'), `${name}: approve option`);
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

test('no procedure passes --override without an Override menu', () => {
  for (const name of allProcedures) {
    const src = read(name);
    if (!src.includes('--override')) continue;
    assert.ok(src.includes('[cairn:override '), `${name}: --override needs a [cairn:override <slug>] menu`);
    assert.match(src, /Override/, `${name}: the menu has an Override option`);
  }
});
