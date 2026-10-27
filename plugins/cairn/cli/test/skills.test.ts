import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parse } from 'yaml';

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills');

// Every subcommand named in the CLI USAGE text (src/main.ts), except `repro`.
const SUBCOMMANDS = [
  'area',
  'recall',
  'index',
  'next',
  'status',
  'new',
  'product',
  'decide',
  'approve',
  'advance',
  'plan',
  'ready',
  'task',
  'evidence',
  'drift',
  'pause',
  'resume',
  'close',
  'render',
  'escalate',
  'migrate',
];

type Skill = { name: string; allowedTools: string[] };

function loadSkills(): Skill[] {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const text = readFileSync(join(SKILLS_DIR, entry.name, 'SKILL.md'), 'utf8');
      const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text);
      assert.ok(frontmatter, `${entry.name}/SKILL.md has no frontmatter`);
      const meta = parse(frontmatter[1]) as { 'allowed-tools'?: unknown };
      const raw = meta['allowed-tools'];
      const allowedTools = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : [];
      return { name: entry.name, allowedTools };
    });
}

const skills = loadSkills();

test('every skill pre-approves each cairn subcommand by name', () => {
  assert.ok(skills.length > 0, 'no skills found');
  for (const skill of skills) {
    for (const sub of SUBCOMMANDS) {
      assert.ok(
        skill.allowedTools.includes(`Bash(cairn ${sub}:*)`),
        `${skill.name} does not allow Bash(cairn ${sub}:*)`,
      );
    }
  }
});

test('no skill pre-approves every cairn command with cairn:*', () => {
  for (const skill of skills) {
    for (const tool of skill.allowedTools) {
      assert.ok(!tool.includes('cairn:*'), `${skill.name} allows ${tool}`);
    }
  }
});

test('no skill pre-approves cairn repro', () => {
  for (const skill of skills) {
    for (const tool of skill.allowedTools) {
      assert.ok(!/cairn\s+repro\b/.test(tool), `${skill.name} allows ${tool}`);
    }
  }
});
