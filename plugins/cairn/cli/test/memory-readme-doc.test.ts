import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pluginRoot } from '../src/util.ts';

const repoRoot = join(pluginRoot(), '..', '..');
const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
const cliDoc = readFileSync(join(pluginRoot(), 'references', 'cli.md'), 'utf8');

const section = (src: string, heading: string): string => {
  const start = src.indexOf(`\n${heading}\n`);
  assert.ok(start >= 0, `README is missing "${heading}"`);
  const next = src.indexOf('\n## ', start + 1);
  return src.slice(start, next < 0 ? undefined : next);
};

const projectMemory = section(readme, '## Project memory');

test('the Project memory section describes records, the changelog, the tab, and session start', () => {
  for (const p of ['RECORD.md', 'changelog.md', '120 words', 'docs/cairn/OVERVIEW.md', 'Changelog tab', 'five most recent entries', 'cairn index']) {
    assert.ok(projectMemory.includes(p), `Project memory is missing "${p}"`);
  }
});

test('the Project memory section says the old folders are no longer read and can be deleted', () => {
  assert.match(projectMemory, /docs\/cairn\/system\/`? and `?docs\/cairn\/decisions\//);
  assert.match(projectMemory, /no longer read and can be deleted/);
});

test('the Project memory section presents no removed feature as current', () => {
  // The removal note under "Upgrading from 0.6" may name them; nothing above it may.
  const current = projectMemory.slice(0, projectMemory.indexOf('### Upgrading from 0.6'));
  assert.ok(current.length > 0, 'Project memory is missing "Upgrading from 0.6"');
  for (const re of [/cairn recall/, /area docs?\b/i, /cairn area/, /lasting decision/i, /\/cairn:map/, /--lasting/]) {
    assert.ok(!re.test(current), `Project memory presents ${re} as current`);
  }
  assert.match(projectMemory, /removed `\/cairn:map`/);
});

test('the pane has four tabs and the README says so', () => {
  assert.match(readme, /It has four tabs, \*\*Now\*\*, \*\*History\*\*, \*\*Records\*\*, and \*\*Changelog\*\*/);
  assert.ok(readme.includes('### Changelog'));
  assert.ok(!/It has three tabs/.test(readme));
});

test('the README keeps the upgrade note for 0.5 and lists changelog.md in a plan\'s documents', () => {
  assert.ok(readme.includes('### Upgrading from 0.5'));
  assert.match(readme, /\| A plan's documents \|[^\n]*`changelog\.md`/);
});

test('cli.md lists no removed command as current', () => {
  const removed = [/cairn recall/, /cairn area/, /area skip/, /--lasting/, /--promote/, /--replaces/, /\/cairn:map/];
  for (const line of cliDoc.split('\n')) {
    for (const re of removed) {
      if (re.test(line)) assert.ok(/removed/i.test(line), `cli.md presents ${re} as current: ${line.slice(0, 80)}`);
    }
  }
});

test('cli.md documents the removal refusal, plain decide, and the changelog', () => {
  for (const p of ['was removed; the changelog in docs/cairn/OVERVIEW.md replaces it.', 'cairn decide "<question>" "<answer>" [--why', 'cairn decide --file', '`changelog.md`', 'entry?']) {
    assert.ok(cliDoc.includes(p), `cli.md is missing "${p}"`);
  }
});

test('the session-start overview is described as the five newest entries, not areas or decisions', () => {
  assert.ok(cliDoc.includes('Older work: docs/cairn/OVERVIEW.md'));
  assert.ok(!/decisions in force/i.test(cliDoc));
});
