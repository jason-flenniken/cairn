import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { planEntries } from '../src/commands/records.ts';
import { context } from '../src/locate.ts';
import { run } from '../src/main.ts';
import { memoryIndex, renderChangelog } from '../src/memory.ts';
import { stripControl } from '../src/util.ts';

const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const mk = (): string => {
  const r = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-changelog-')));
  g(r, 'init', '-q', '-b', 'main');
  writeFileSync(join(r, 'README.md'), 'hi\n');
  g(r, 'add', '-A');
  g(r, 'commit', '-q', '-m', 'init');
  return r;
};
let repos: string[] = [];
before(() => Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }));
after(() => repos.forEach((r) => rmSync(r, { recursive: true, force: true })));
const fresh = () => {
  const r = mk();
  repos.push(r);
  return r;
};

/** A closed plan in the main checkout. `entry` is changelog.md; `why` is the record's Why section. */
function closed(root: string, date: string, slug: string, o: { entry?: string; why?: string; stage?: string } = {}): string {
  const dir = join(root, 'docs/cairn/plans', `${date}-${slug}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ slug, title: `Plan ${slug}`, track: 'feature', stage: o.stage ?? 'closed', created: `${date}T00:00:00Z`, branch: `feature/${slug}`, phases: [], approvals: {}, evidence: {}, drift: [], suggestions: [], log: [] }));
  if (o.entry !== undefined) writeFileSync(join(dir, 'changelog.md'), o.entry);
  if (o.why !== undefined) writeFileSync(join(dir, 'RECORD.md'), `# Record\n\n## Why\n${o.why}\n\n## What was built\nx\n`);
  return dir;
}
const plans = (root: string) => planEntries(context(root));

test('OVERVIEW is a newest-first changelog with entries, the fallback sentence, and links that resolve', () => {
  const r = fresh();
  closed(r, '2026-01-01', 'oldest', { entry: 'Oldest shipped a thing.\n', why: 'ignored. more.' });
  closed(r, '2026-03-01', 'newest', { entry: 'Newest shipped another.\n' });
  closed(r, '2026-02-01', 'middle', { why: 'Middle fixed a gap. Then more words.' });
  closed(r, '2026-04-01', 'open', { stage: 'build', entry: 'not closed' });
  run(['render'], r);
  const md = readFileSync(join(r, 'docs/cairn/OVERVIEW.md'), 'utf8');
  assert.ok(md.indexOf('Plan newest') < md.indexOf('Plan middle') && md.indexOf('Plan middle') < md.indexOf('Plan oldest'));
  assert.match(md, /## 2026-03-01 · Plan newest\n\nNewest shipped another\.\n/);
  assert.match(md, /## 2026-02-01 · Plan middle\n\nMiddle fixed a gap\.\n/);
  assert.ok(!md.includes('ignored'));
  assert.ok(!md.includes('Plan open'), 'open plans are left out');
  assert.doesNotMatch(md, /Areas|Decisions/);
  const links = [...md.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
  assert.equal(links.length, 2, 'only plans with a record link');
  for (const l of links) assert.ok(existsSync(join(r, 'docs/cairn', l)), l);
});

test('a plan with neither entry nor record shows its date and title only; an unreadable entry is skipped', () => {
  const r = fresh();
  closed(r, '2026-01-01', 'bare');
  const bad = closed(r, '2026-02-01', 'broken', { why: 'Fallback not shown.' });
  mkdirSync(join(bad, 'changelog.md'));
  closed(r, '2026-03-01', 'fine', { entry: 'Fine entry.' });
  const md = renderChangelog(r, plans(r));
  assert.match(md, /## 2026-01-01 · Plan bare\n(?!\n[A-Za-z])/);
  assert.ok(md.includes('Fine entry.') && md.includes('Plan broken'));
  const idx = memoryIndex(r, plans(r));
  assert.ok(idx.includes('Fine entry.') && idx.includes('Plan bare'));
  assert.ok(!idx.includes('Plan broken'), 'the unreadable plan is left out of the index');
});

test('no closed plans: the index is empty and cairn index prints nothing', () => {
  const r = fresh();
  closed(r, '2026-01-01', 'open', { stage: 'plan', entry: 'x' });
  assert.equal(memoryIndex(r, plans(r)), '');
  assert.equal(run(['index'], r).message, '');
  assert.match(renderChangelog(r, plans(r)), /None yet\./);
});

test('the index holds the five newest entries and the pointer line', () => {
  const r = fresh();
  for (let i = 1; i <= 7; i++) closed(r, `2026-01-0${i}`, `p${i}`, { entry: `Entry ${i}.` });
  const lines = memoryIndex(r, plans(r)).split('\n');
  const entries = lines.filter((l) => l.startsWith('- '));
  assert.equal(entries.length, 5);
  assert.deepEqual(entries.map((l) => l.match(/Entry (\d)/)![1]), ['7', '6', '5', '4', '3']);
  assert.match(lines.at(-1)!, /docs\/cairn\/OVERVIEW\.md$/);
});

test('a 200-word entry is cut to 120 words in the index and kept whole in OVERVIEW', () => {
  const r = fresh();
  const words = Array.from({ length: 200 }, (_, i) => `w${i}`);
  closed(r, '2026-01-01', 'long', { entry: `${words.join(' ')}\n` });
  const idx = memoryIndex(r, plans(r));
  assert.ok(idx.includes('w119') && !idx.includes('w120'));
  assert.ok(renderChangelog(r, plans(r)).includes('w199'));
});

test('control characters are stripped from the index and records --json, newlines kept', () => {
  const r = fresh();
  closed(r, '2026-01-01', 'esc', { entry: 'Line one \x1b[2J\x07rung.\nLine two.\n', why: 'Why \x1b[31mred. x' });
  const idx = memoryIndex(r, plans(r));
  assert.doesNotMatch(idx, /[\x00-\x08\x0b-\x1f\x7f]/);
  assert.ok(idx.includes('Line one'));
  const rec = (run(['records', '--json'], r).data!.records as any[])[0];
  assert.doesNotMatch(JSON.stringify(rec).replace(/\\n/g, ''), /\\u00[01]|\x1b|\x07/);
  assert.equal(rec.entry, 'Line one [2Jrung.\nLine two.');
  assert.equal(stripControl('a\tb\nc\x1b\x07\r'), 'a\tb\nc');
});
