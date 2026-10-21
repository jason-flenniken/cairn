import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
    'only the file, the line and the kind',
    'grep -cE',
    'awk',
    'pip-audit --no-deps --disable-pip -r',
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

test('verify.md never audits Python by installing, and leaves poetry.lock out', () => {
  const src = read('procedures/verify.md');
  for (const m of src.matchAll(/pip-audit(?! --no-deps --disable-pip)[^\n]*/g)) {
    assert.match(m[0], /^pip-audit` without/, `bare pip-audit: ${m[0].slice(0, 60)}`);
  }
  assert.doesNotMatch(src, /`poetry\.lock` or/);
  assert.match(src, /`poetry\.lock` is not audited/);
});

test('the awk secret scan prints file, line and kind and never the matched text', () => {
  const src = read('procedures/verify.md');
  const prog = src.match(/awk '\n([\s\S]*?)'\n/)?.[1].replace(/^ {5}/gm, '');
  assert.ok(prog, 'awk program in verify.md');
  const ghp = `ghp_${'a'.repeat(36)}`;
  const diff = [
    '+++ b/src/config.js',
    '@@ -1,0 +5,3 @@',
    '+const ok = 1',
    '+const password = "hunter2xyz"',
    '+const key = "AKIAABCDEFGHIJKLMNOP"',
    '+++ b/src/other.js',
    '@@ -9 +20 @@',
    `+token = ${ghp}`,
    '',
  ].join('\n');
  const out = execFileSync('awk', [prog], { input: diff, encoding: 'utf8' });
  assert.equal(out, 'src/config.js:6:literal credential\nsrc/config.js:7:aws key\nsrc/other.js:20:github token\n');
  for (const v of ['AKIAABCDEFGHIJKLMNOP', 'hunter2xyz', ghp]) assert.ok(!out.includes(v), 'value leaked');
});

test('config template and cli.md name the audit key', () => {
  const cfg = JSON.parse(read('templates/config.json'));
  assert.equal(typeof cfg.audit, 'string');
  assert.ok(read('references/cli.md').includes('`audit`'));
});
