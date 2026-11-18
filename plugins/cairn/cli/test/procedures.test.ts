import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pluginRoot } from '../src/util.ts';

const root = pluginRoot();
const procedureDir = join(root, 'procedures');
const read = (name: string) => readFileSync(join(procedureDir, `${name}.md`), 'utf8');
const allProcedures = readdirSync(procedureDir)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.slice(0, -3));

test('board offers to narrow wide epic links with the relink procedure', () => {
  assert.match(read('board'), /Narrow them \(Recommended\)[^\n]*procedures\/relink\.md/);
  const relink = read('relink');
  for (const t of ['save_issue', 'removeBlockedBy', 'save_comment', 'cairn linear relink', 'cairn linear import --board --links', 'Apply (Recommended)'])
    assert.ok(relink.includes(t), `relink.md mentions ${t}`);
  assert.ok(relink.indexOf('blockedBy: [<keys>]') < relink.indexOf('removeBlockedBy'), 'links are added before the epic link is removed');
});

// Each procedure with an approval menu, and the kinds its tags may name.
const APPROVALS: Record<string, string[]> = {
  prd: ['prd'],
};

// Option labels that must not sit between an approval tag and its "Approve (Recommended)".
const OTHER_LABELS = ['Revise', 'Hold', 'Pause', 'Fix', 'Continue'];

test('each approval procedure has its tagged menu, Approve (Recommended) first, and the --human fallback', () => {
  for (const [name, kinds] of Object.entries(APPROVALS)) {
    const src = read(name);
    const tags = [...src.matchAll(/\[cairn:approve (\w+) <slug>\]/g)];
    assert.ok(tags.length > 0, `${name}: has an approval tag`);
    for (const kind of kinds)
      assert.ok(tags.some((t) => t[1] === kind), `${name}: has a tag for ${kind}`);
    for (const tag of tags) {
      assert.ok(kinds.includes(tag[1]), `${name}: tag kind "${tag[1]}" matches the procedure`);
      const after = src.slice(tag.index + tag[0].length);
      const approve = after.indexOf('Approve (Recommended)');
      assert.ok(approve >= 0, `${name}: Approve (Recommended) follows the tag`);
      const before = after.slice(0, approve);
      for (const label of OTHER_LABELS)
        assert.ok(!new RegExp(`\\b${label}\\b`).test(before), `${name}: "${label}" comes before Approve (Recommended)`);
    }
    for (const kind of kinds)
      assert.match(src, new RegExp(`cairn approve ${kind} --human`), `${name}: --human fallback for ${kind}`);
    assert.match(src, /modActive/, `${name}: checks modActive`);
  }
});

test('no procedure runs cairn approve outside the --human fallback', () => {
  for (const name of allProcedures) {
    for (const line of read(name).split('\n')) {
      if (!line.includes('cairn approve ')) continue;
      assert.ok(line.includes('--human'), `${name}: "${line.trim()}"`);
    }
  }
});

// After the PRD approval the run is hands-off: only the sitting procedures and the user's own commands ask anything.
const MAY_ASK = ['new', 'spec', 'board', 'discover', 'prd', 'resume', 'pause', 'system'];

test('no procedure after the PRD approval asks with AskUserQuestion', () => {
  for (const name of allProcedures) {
    if (MAY_ASK.includes(name)) continue;
    assert.doesNotMatch(read(name), /AskUserQuestion/, `${name} mentions AskUserQuestion`);
  }
});

function markdownUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...markdownUnder(p));
    else if (e.name.endsWith('.md') || e.name === 'SKILL.md') out.push(p);
  }
  return out;
}

test('the removed approvals and the override are gone from procedures, references, agents and skills', () => {
  const files = ['procedures', 'references', 'agents', 'skills'].flatMap(markdownUnder).filter((f) => f !== join('references', 'cli.md'));
  assert.ok(files.length > 20, 'found the markdown files');
  for (const f of files) {
    const src = readFileSync(join(root, f), 'utf8');
    for (const banned of ['[cairn:override', '[cairn:approve plan', '[cairn:approve ship', '--override'])
      assert.ok(!src.includes(banned), `${f} contains ${banned}`);
  }
});

test('autonomy.md says what to decide, what to record as not done, and what is the user\'s', () => {
  const src = read('../references/autonomy').toString();
  for (const needle of ['cairn decide "Assumed:', '--call "', '--not-done "', 'blocked --note "set aside:', 'cairn prove add', 'PRD approval', 'The merge'])
    assert.ok(src.includes(needle), needle);
  assert.doesNotMatch(src, /The one stop|Still a stop/);
});
