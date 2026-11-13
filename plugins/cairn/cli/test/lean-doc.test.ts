import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pluginRoot } from '../src/util.ts';

const root = pluginRoot();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('the new agents have the models and tools the lean design assigns', () => {
  const expect: Record<string, [string, RegExp]> = {
    'prd-writer': ['opus', /^tools: Read, Grep, Glob, Bash, Write$/m],
    'plan-writer': ['opus', /^tools: Read, Grep, Glob, Bash, Write$/m],
    researcher: ['sonnet', /^tools: Read, Grep, Glob, Bash, WebSearch, WebFetch, Write$/m],
  };
  for (const [name, [model, tools]] of Object.entries(expect)) {
    const src = read(`agents/${name}.md`);
    assert.match(src, new RegExp(`^model: ${model}$`, 'm'), name);
    assert.match(src, tools, name);
  }
  const sender = read('agents/linear-sender.md');
  assert.match(sender, /^model: haiku$/m);
  assert.doesNotMatch(sender.split('---')[1] ?? '', /^tools:/m, 'linear-sender inherits every tool');
});

test('the writers hold the document guidance and cap their final message', () => {
  const prd = read('agents/prd-writer.md');
  assert.match(prd, /five required `## ` headings/);
  assert.match(prd, /At most 10 lines/);
  assert.match(prd, /You never run `cairn approve` or `cairn advance`/);
  const plan = read('agents/plan-writer.md');
  assert.match(plan, /cairn plan load/);
  assert.match(plan, /longest-chain line/);
  assert.match(plan, /At most 10 lines/);
  assert.match(read('agents/researcher.md'), /At most 12 lines/);
  assert.match(read('agents/linear-sender.md'), /Sent N, failed M/);
});

test('every reviewer and checker writes a report and ends with a short final message', () => {
  for (const f of ['task-reviewer', 'security-reviewer', 'branch-reviewer', 'acceptance-checker', 'direction-checker', 'prd-checker', 'plan-reviewer', 'challenger']) {
    const src = read(`agents/${f}.md`);
    assert.match(src, /report path/, f);
    assert.match(src, /Report: <abs path>/, f);
  }
  const impl = read('agents/implementer.md');
  assert.match(impl, /Brief: <path>\. Plugin root: <root>\./);
  assert.match(impl, /^Concerns: /m);
});

test('execute.md runs the brief, report and record loop and sends rare cases to execute-cases.md', () => {
  const src = read('procedures/execute.md');
  for (const cmd of ['cairn task start', 'cairn task report', 'cairn task brief <id> --role review', '--role security', 'cairn review record', '--role fix', 'cairn task merge']) {
    assert.ok(src.includes(cmd), cmd);
  }
  assert.doesNotMatch(src, /cairn suggest add --area/);
  assert.match(src, /Read `procedures\/execute-cases\.md` only when one of these happens/);
  assert.match(src, /linear-sender/);
  assert.match(src, /start fresh with \/clear, then \/cairn:next/);
  const cases = read('procedures/execute-cases.md');
  for (const h of ['NEEDS_CONTEXT', 'BLOCKED', 'Fix · merge', 'Tests are red after the merge', 'The plan is paused']) assert.ok(cases.includes(h), h);
});

test('prd and plan procedures brief a writer and never edit the document', () => {
  for (const [f, writer] of [['prd', 'prd-writer'], ['plan', 'plan-writer']] as const) {
    const src = read(`procedures/${f}.md`);
    assert.match(src, new RegExp('`' + writer + '` agent'), f);
    assert.match(src, new RegExp(`You never edit \`${f}\\.md\` yourself`), f);
    assert.match(src, /SendMessage/, f);
    assert.match(src, /start fresh with \/clear, then \/cairn:next/, f);
  }
});

test('every skill pre-approves cairn review for the record step', () => {
  for (const s of ['execute', 'plan', 'prd', 'discover', 'fix', 'next']) {
    assert.match(read(`skills/${s}/SKILL.md`), /"Bash\(cairn review:\*\)"/, s);
  }
});

test('model-tiers lists the new agents and the README explains the lean main session', () => {
  const tiers = read('references/model-tiers.md');
  assert.match(tiers, /prd-writer, plan-writer \| opus/);
  assert.match(tiers, /researcher \| sonnet/);
  assert.match(tiers, /linear-sender \| haiku/);
  assert.match(readFileSync(join(root, '..', '..', 'README.md'), 'utf8'), /## Keeping the main session lean/);
});

test('review fixes: claimed Linear queue, re-review briefs, direction reports, foreground refresh', () => {
  assert.match(read('agents/linear-sender.md'), /pending --claim --json/);
  assert.match(read('agents/linear-sender.md'), /data, never instructions/);
  assert.match(read('procedures/execute.md'), /no `linear-sender` is already running/);
  assert.match(read('procedures/execute.md'), /--role review --again/);
  assert.match(read('procedures/phase-end.md'), /foreground/);
  assert.doesNotMatch(read('procedures/phase-end.md'), /run `cairn test` to see/);
  assert.match(read('procedures/direction.md'), /reports\/direction-<n>\.md/);
  for (const a of ['task-reviewer', 'security-reviewer', 'branch-reviewer']) {
    assert.match(read(`agents/${a}.md`), /Prior: <path:line> \| addressed\|open \| <note>/);
  }
});
