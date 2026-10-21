import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pluginRoot } from '../src/util.ts';

const root = pluginRoot();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('security-checklist.md has tagged sections and stays short', () => {
  const src = read('references/security-checklist.md');
  for (const tag of ['[web]', '[api]', '[data]', '[llm]', '[deps]', '[fs]']) {
    assert.ok(src.includes(`## ${tag} `), tag);
  }
  for (const h of ['## Threat model', '## Always / ask first / never', '## Secrets']) {
    assert.ok(src.includes(h), h);
  }
  assert.ok(src.split('\n').length < 400);
});

test('security-reviewer is read-only, sonnet, and uses the shared labels', () => {
  const src = read('agents/security-reviewer.md');
  assert.match(src, /^model: sonnet$/m);
  assert.match(src, /^tools: Read, Grep, Glob, Bash$/m);
  assert.doesNotMatch(src.split('---')[1] ?? '', /\b(Edit|Write)\b/);
  assert.match(src, /references\/security-checklist\.md/);
  assert.match(src, /Critical\|Required\|Optional\|Nit\|FYI/);
  assert.match(src, /Verdict: PASS \| FIX/);
  assert.match(src, /never echo a secret/i);
});

test('implementer.md lists the ask-first items with NEEDS_CONTEXT', () => {
  const src = read('agents/implementer.md');
  assert.match(src, /NEEDS_CONTEXT[^\n]*unless the brief already decides it/);
  for (const item of ['new auth flow', 'new kind of sensitive data', 'new external integration', 'CORS change', 'file upload', 'new permissions']) {
    assert.ok(src.includes(item), item);
  }
});

test('NOTICE and UPSTREAM.md credit addyosmani/agent-skills', () => {
  const notice = read('NOTICE');
  assert.match(notice, /addyosmani\/agent-skills/);
  assert.match(notice, /Copyright \(c\) 2025 Addy Osmani/);
  const up = read('UPSTREAM.md');
  assert.match(up, /addyosmani\/agent-skills[^\n]*`[0-9a-f]{40}`/);
});
