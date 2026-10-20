import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { HANDOFF_SECTIONS, missingSections, PLAN_SECTIONS, PRD_SECTIONS, RECORD_SECTIONS } from '../src/sections.ts';
import { pluginRoot } from '../src/util.ts';

const root = pluginRoot();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('templates carry every section the CLI gates on', () => {
  assert.deepEqual(missingSections(read('templates/prd.md'), PRD_SECTIONS), []);
  assert.deepEqual(missingSections(read('templates/plan.md'), PLAN_SECTIONS), []);
  assert.deepEqual(missingSections(read('templates/record.md'), RECORD_SECTIONS), []);
  assert.deepEqual(missingSections(read('templates/handoff.md'), HANDOFF_SECTIONS), []);
  assert.match(read('templates/plan.md'), /```yaml cairn-slices/);
});

test('every procedure cairn next can route to exists', () => {
  for (const p of ['new', 'discover', 'prd', 'plan', 'execute', 'phase-end', 'verify', 'review', 'ship', 'learn', 'resume', 'status'])
    assert.ok(existsSync(join(root, 'procedures', `${p}.md`)), `procedures/${p}.md`);
});

test('every agent pins a model and every skill is user-invoked only', () => {
  for (const f of readdirSync(join(root, 'agents'))) assert.match(read(`agents/${f}`), /^model:\s*(haiku|sonnet|opus)\s*$/m, f);
  for (const d of readdirSync(join(root, 'skills'))) assert.match(read(`skills/${d}/SKILL.md`), /^disable-model-invocation:\s*true\s*$/m, d);
});
