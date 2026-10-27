import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pluginRoot } from '../src/util.ts';

const root = pluginRoot();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const has = (file: string, ...phrases: string[]) => {
  const src = read(file);
  for (const p of phrases) assert.ok(src.includes(p), `${file} is missing "${p}"`);
};

test('ship and fix require changelog.md before the approval, and the stops show it', () => {
  for (const f of ['procedures/ship.md', 'procedures/fix.md']) {
    has(f, 'changelog.md', '120 words', 'what was', 'big rocks', 'Record · changelog entry');
    const src = read(f);
    assert.ok(src.indexOf('changelog.md') < src.indexOf('cairn step approving'), `${f} writes the entry after the stop`);
    assert.match(src, /Revise the record or the entry/);
  }
  has('procedures/ship.md', 'the changelog entry');
  has('procedures/fix.md', 'the changelog entry');
});

test('recorder writes the changelog entry', () => {
  has('agents/recorder.md', '## Changelog entry', 'changelog.md', '120 words', 'big rocks', 'wc -w');
  assert.ok(!read('agents/recorder.md').includes('## Area docs'));
});

test('discover hands its research agent OVERVIEW.md', () => {
  has('procedures/discover.md', 'docs/cairn/OVERVIEW.md');
});

test('no procedure, agent, or reference mentions the removed memory system', () => {
  const banned = [/cairn recall/, /area docs?\b/i, /decisions? in force/i, /what to respect/i, /cairn area/, /--lasting/, /--promote/, /--replaces/];
  for (const dir of ['procedures', 'agents', 'references']) {
    for (const f of readdirSync(join(root, dir))) {
      const src = read(`${dir}/${f}`);
      for (const re of banned) assert.ok(!re.test(src), `${dir}/${f} still matches ${re}`);
    }
  }
});

test('the map skill, procedure, and area template are gone', () => {
  const skills = readdirSync(join(root, 'skills'));
  assert.ok(!skills.includes('map'));
  assert.ok(!readdirSync(join(root, 'procedures')).includes('map.md'));
  assert.ok(!readdirSync(join(root, 'templates')).includes('area.md'));
});

test('new treats the legacy config as present', () => {
  has('procedures/new.md', '.sdlc/config.json', 'cairn migrate');
});
