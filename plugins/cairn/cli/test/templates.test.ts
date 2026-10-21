import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { HANDOFF_SECTIONS, missingSections, PLAN_SECTIONS, PRD_SECTIONS, RECORD_SECTIONS } from '../src/sections.ts';
import { parseScorecard } from '../src/direction.ts';
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
  for (const p of ['new', 'discover', 'prd', 'plan', 'execute', 'phase-end', 'direction', 'verify', 'review', 'ship', 'learn', 'resume', 'status'])
    assert.ok(existsSync(join(root, 'procedures', `${p}.md`)), `procedures/${p}.md`);
});

test('every agent pins a model and every skill is user-invoked only', () => {
  for (const f of readdirSync(join(root, 'agents'))) assert.match(read(`agents/${f}`), /^model:\s*(haiku|sonnet|opus)\s*$/m, f);
  for (const d of readdirSync(join(root, 'skills'))) assert.match(read(`skills/${d}/SKILL.md`), /^disable-model-invocation:\s*true\s*$/m, d);
});

test('phase-end runs the direction check, lets only the CLI compute the verdict, and offers a clean start', () => {
  const t = read('procedures/phase-end.md');
  assert.match(t, /cairn-direction/);
  assert.match(t, /cairn evidence phase/);
  assert.match(t, /\[cairn:approve phase <slug>\]/);
  assert.match(t, /Approve \(Recommended\)/);
  assert.match(t, /\/clear, then \/cairn:next/);
  assert.doesNotMatch(t, /evidence phase[^\n]*--(result|verdict|color)/i);
  assert.doesNotMatch(t, /record (the |a )?(verdict|colou?r)/i);
});

test('the direction procedure, agent, and skill fit together', () => {
  const t = read('procedures/direction.md');
  assert.match(t, /```yaml cairn-direction/);
  assert.match(t, /direction-checker/);
  assert.match(t, /docs\/sdlc\/product\/PRD\.md/);
  assert.match(t, /cairn evidence phase/);
  assert.ok(!t.includes('--override'), 'direction.md must not tell the agent to override');
  const block = /```yaml cairn-direction\n([\s\S]*?)```/.exec(t);
  assert.ok(block, 'direction.md has an example cairn-direction block');
  const { rows, problems } = parseScorecard(`\`\`\`yaml cairn-direction\n${block[1]}\`\`\``);
  assert.deepEqual(problems, []);
  assert.ok(rows.requirements.length > 0);
  const a = read('agents/direction-checker.md');
  assert.match(a, /^model:\s*sonnet\s*$/m);
  assert.doesNotMatch(a, /^tools:.*\b(Write|Edit)\b/m);
  const k = read('skills/direction/SKILL.md');
  assert.match(k, /^\s+- "Bash\(cairn status:\*\)"\s*$/m);
  assert.doesNotMatch(k, /cairn:\*/);
  assert.doesNotMatch(k, /cairn repro/);
  assert.match(k, /procedures\/direction\.md/);
});
