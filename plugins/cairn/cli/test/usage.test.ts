import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { run } from '../src/main.ts';
import { formatTokens, formatUsage, planUsage } from '../src/usage.ts';
import { pd } from './plandir.ts';

let repo: string;
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const common = () => join(repo, '.git');
const ledger = (slug: string, id: string, body: unknown) => {
  const d = join(common(), 'cairn', 'usage', slug);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, `${id}.json`), typeof body === 'string' ? body : JSON.stringify(body));
};
const session = (usd: number, stage: string) => ({
  sessionId: 's',
  usd,
  tokens: { input: 1000, output: 2000, cacheRead: 300000, cacheWrite: 40000 },
  tokensByModel: { 'claude-opus-5-5': 200000, 'claude-sonnet-5-5': 143000 },
  weekPct: 4.2,
  byStage: { [stage]: { usd, tokens: 343000, weekPct: 4.2 } },
  updatedAt: '2026-11-14T10:00:00.000Z',
});
/** Move a fresh plan to learn with a valid record, committed, ready to close. */
function learnPlan(slug: string, title: string): string {
  const wt = run(['new', slug, '--title', title], repo).data!.worktree as string;
  const f = join(pd(wt, slug), 'state.json');
  const s = JSON.parse(readFileSync(f, 'utf8'));
  s.stage = 'learn';
  writeFileSync(f, JSON.stringify(s, null, 2));
  copyFileSync(join(import.meta.dirname, '../../templates/record.md'), join(pd(wt, slug), 'RECORD.md'));
  g(wt, 'add', '-A');
  g(wt, 'commit', '-q', '-m', 'learn');
  return wt;
}

before(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-usage-')));
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  mkdirSync(join(repo, '.cairn'));
  writeFileSync(join(repo, '.cairn/config.json'), JSON.stringify({ autoCommit: true }));
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

test('planUsage sums sessions, skips a corrupt file, and ignores week.json', () => {
  assert.equal(planUsage(common(), 'sum'), undefined);
  ledger('sum', 'a', session(10, 'execute'));
  ledger('sum', 'b', session(2.5, 'review'));
  ledger('sum', 'bad', '{not json');
  writeFileSync(join(common(), 'cairn', 'usage', 'week.json'), '{}');
  const u = planUsage(common(), 'sum')!;
  assert.equal(u.sessions, 2);
  assert.equal(u.usd, 12.5);
  assert.equal(u.tokens.total, 2 * 343000);
  assert.equal(u.tokens.cacheRead, 600000);
  assert.equal(u.tokensByModel['claude-opus-5-5'], 400000);
  assert.ok(Math.abs(u.weekPct - 8.4) < 1e-9);
  assert.deepEqual(Object.keys(u.byStage).sort(), ['execute', 'review']);
  assert.equal(u.byStage.execute!.usd, 10);
});

test('formatting', () => {
  assert.equal(formatTokens(850), '850');
  assert.equal(formatTokens(45000), '45k');
  assert.equal(formatTokens(1_200_000), '1.2M');
  const t = (total: number) => ({ total });
  assert.equal(formatUsage({ usd: 42.1, tokens: t(18_200_000), weekPct: 18.2 }), '$42.10 · 18M tokens · ≈18% of weekly limit');
  assert.equal(formatUsage({ usd: 1, tokens: t(850), weekPct: 4.24 }), '$1.00 · 850 tokens · ≈4.2% of weekly limit');
});

test('status shows the usage line and --json carries usage; close writes usage.json and USAGE.md and commits them', () => {
  const slug = 'costly';
  const wt = learnPlan(slug, 'Costly');
  assert.doesNotMatch(run(['status'], wt).message, /Usage:/);
  assert.equal(run(['status', '--json'], wt).data!.usage, undefined);
  ledger(slug, 'a', session(10, 'execute'));
  ledger(slug, 'b', session(2.5, 'review'));
  ledger(slug, 'bad', 'oops');
  assert.match(run(['status'], wt).message, /Usage: \$12\.50 · 686k tokens · ≈8\.4% of weekly limit/);
  const u = run(['status', '--json'], wt).data!.usage as Record<string, any>;
  assert.equal(u.usd, 12.5);
  assert.equal(u.sessions, 2);
  assert.equal(u.tokens.total, 686000);

  assert.match(run(['close'], wt).message, /Closed/);
  const saved = JSON.parse(readFileSync(join(pd(wt, slug), 'usage.json'), 'utf8'));
  assert.equal(saved.slug, slug);
  assert.equal(saved.usd, 12.5);
  assert.ok(Date.parse(saved.closedAt));
  const md = readFileSync(join(wt, 'docs/cairn/USAGE.md'), 'utf8');
  assert.match(md, /^# Usage/);
  assert.match(md, /\| \d{4}-\d\d-\d\d \| \[costly\]\(plans\/[^)]*costly\/RECORD\.md\) \| \$12\.50 \| 686k \| 8\.4% \| execute \$10 · review \$2\.50 \|/);
  assert.ok(existsSync(join(wt, 'docs/cairn', md.match(/\]\(([^)]+)\)/)![1]!)));
  assert.equal(g(wt, 'status', '--porcelain'), '');
  const files = g(wt, 'show', '--name-only', '--format=', 'HEAD');
  assert.match(files, /usage\.json/);
  assert.match(files, /docs\/cairn\/USAGE\.md/);
  // The ledger is moved aside, so a later plan with the same slug starts at zero.
  assert.ok(!existsSync(join(common(), 'cairn', 'usage', slug)));
  assert.equal(planUsage(common(), slug), undefined);
  assert.ok(readdirSync(join(common(), 'cairn', 'usage', '.closed')).some(n => n.startsWith(`${slug}-`)));
});

test('a plan with no ledger closes without usage.json and is left out of USAGE.md', () => {
  const wt = learnPlan('free', 'Free');
  run(['close'], wt);
  assert.ok(!existsSync(join(pd(wt, 'free'), 'usage.json')));
  assert.doesNotMatch(readFileSync(join(wt, 'docs/cairn/USAGE.md'), 'utf8'), /free/);
});
