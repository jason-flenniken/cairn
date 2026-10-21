import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pluginRoot } from '../src/util.ts';

const root = pluginRoot();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('prd template and procedure describe the threat model and its trigger', () => {
  const tpl = read('templates/prd.md');
  for (const needle of ['Trust boundaries', 'Assets', 'STRIDE', 'Misuse cases', 'security-checklist.md']) {
    assert.ok(tpl.includes(needle), needle);
  }
  const proc = read('procedures/prd.md');
  assert.match(proc, /trust boundary/);
  assert.match(proc, /STRIDE/);
  assert.match(proc, /misuse cases/);
});

test('plan template and procedure carry the wider risky list and the misuse-case rule', () => {
  for (const f of ['templates/plan.md', 'procedures/plan.md']) {
    const src = read(f);
    for (const needle of ['untrusted input', 'personal data', 'new dependency', 'model output', 'shell commands']) {
      assert.ok(src.includes(needle), `${f}: ${needle}`);
    }
    assert.match(src, /misuse case/, f);
    assert.match(src, /Security test/, f);
  }
});

test('verify.md scans for secrets without printing values, audits, and reviews the lockfile', () => {
  const src = read('procedures/verify.md');
  for (const needle of [
    'the file, the line and the kind',
    'Never print the value',
    'npm audit --omit=dev --audit-level=high',
    'never an install',
    'npm audit fix --force',
    'Lockfile diff',
    'revoke',
    'skipped',
    'Retry / Skip with a note / Pause',
  ]) {
    assert.ok(src.includes(needle), needle);
  }
});

test('config template and cli.md name the audit key', () => {
  const cfg = JSON.parse(read('templates/config.json'));
  assert.equal(typeof cfg.audit, 'string');
  assert.ok(read('references/cli.md').includes('`audit`'));
});
