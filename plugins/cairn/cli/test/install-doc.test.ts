import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pluginRoot } from '../src/util.ts';

const root = pluginRoot();
const repo = join(root, '..', '..');
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const marketplace = json(join(repo, '.claude-plugin', 'marketplace.json'));
const plugin = json(join(root, '.claude-plugin', 'plugin.json'));
const readme = readFileSync(join(repo, 'README.md'), 'utf8');

test('the README installs from GitHub with the names the manifests use', () => {
  const entry = marketplace.plugins.find((p: { name: string }) => p.name === plugin.name);
  assert.ok(entry, 'the marketplace lists the plugin under its manifest name');
  assert.equal(entry.source, './plugins/cairn');
  assert.ok(readme.includes('/plugin marketplace add jason-flenniken/cairn'), 'in-session add from GitHub');
  assert.ok(readme.includes(`claude plugin install ${plugin.name}@${marketplace.name}`), 'shell install id matches the manifests');
  assert.ok(readme.includes(`/plugin marketplace update ${marketplace.name}`), 'update command names the marketplace');
  assert.doesNotMatch(readme, /\/Users\//, 'no local paths in the README');
});

test('the plugin carries a release version, its license, and links', () => {
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.equal(plugin.license, 'MIT');
  assert.ok(existsSync(join(repo, 'LICENSE')) && existsSync(join(root, 'LICENSE')), 'LICENSE at the repo root and in the plugin');
  assert.equal(plugin.repository, 'https://github.com/jason-flenniken/cairn');
});

test('the mod types contract is self-contained', () => {
  const src = readFileSync(join(root, 'types', 'index.d.ts'), 'utf8');
  assert.doesNotMatch(src, /^\s*import\b|^\s*export\s[^\n]*\bfrom\s|\brequire\(|\/\/\/\s*<reference/m);
});
