import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pluginRoot } from '../src/util.ts';

const root = pluginRoot();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const FIX_SECTIONS = ['Links', 'Bug', 'Cause', 'Fix', 'Evidence'];

test('the fix record template has the five sections in order', () => {
  const headings = [...read('templates/record-fix.md').matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  assert.deepEqual(headings, FIX_SECTIONS);
});

test('the fix skill is user-invoked only and runs cairn commands', () => {
  const skill = read('skills/fix/SKILL.md');
  assert.match(skill, /^name: fix$/m);
  assert.match(skill, /^disable-model-invocation: true$/m);
  assert.match(skill, /^allowed-tools: Bash\(cairn:\*\)$/m);
  assert.match(skill, /\$\{CLAUDE_PLUGIN_ROOT\}\/procedures\/fix\.md/);
  assert.match(skill, /Procedure files are not variable-expanded/);
});

test('fix.md has the ship approval tag, Approve (Recommended) first, and the --human fallback', () => {
  const src = read('procedures/fix.md');
  const tag = src.indexOf('[cairn:approve ship');
  assert.ok(tag >= 0, 'has the [cairn:approve ship tag');
  const after = src.slice(tag);
  const approve = after.indexOf('Approve (Recommended)');
  assert.ok(approve >= 0, 'Approve (Recommended) follows the tag');
  assert.ok(!/\bRevise\b|\bHold\b/.test(after.slice(0, approve)), 'no other option comes before Approve');
  assert.match(src, /cairn approve ship --human/);
  assert.match(src, /modActive/);
});

test('fix.md runs cairn approve only as the --human text it shows the user', () => {
  for (const line of read('procedures/fix.md').split('\n')) {
    if (!line.includes('cairn approve ')) continue;
    assert.ok(line.includes('--human'), `not a --human line: "${line.trim()}"`);
  }
});

test('fix.md offers escalate with AskUserQuestion for a fix past the file limit', () => {
  const src = read('procedures/fix.md');
  assert.match(src, /cairn escalate/);
  assert.match(src, /slice done/);
  assert.match(src, /AskUserQuestion/);
});

test('fix.md asks for a better repro when the repro command exits 0', () => {
  assert.match(read('procedures/fix.md'), /exits 0[\s\S]*better repro/);
});

test('fix.md never pre-approves the repro command', () => {
  const src = read('procedures/fix.md');
  assert.doesNotMatch(src, /Bash\(cairn repro/);
  assert.doesNotMatch(src, /allowed-tools/);
  assert.doesNotMatch(src, /pre-?approv/i);
  for (const line of src.split('\n')) {
    if (!/repro/.test(line)) continue;
    assert.doesNotMatch(line, /\ballow/i, `repro line mentions an allow list: "${line.trim()}"`);
  }
});
