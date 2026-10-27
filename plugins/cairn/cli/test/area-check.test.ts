import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { run } from '../src/main.ts';
import { Refusal } from '../src/util.ts';
import { pd } from './plandir.ts';

let repo: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const write = (p: string, s: string) => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, s);
};
const commitAll = (cwd: string, msg: string) => {
  g(cwd, 'add', '-A');
  g(cwd, 'commit', '-q', '-m', msg);
};
const ok = (cwd: string, ...argv: string[]) => run(argv, cwd);
const refused = (cwd: string, pattern: RegExp, ...argv: string[]) =>
  assert.throws(
    () => run(argv, cwd),
    (e: unknown) => {
      assert.ok(e instanceof Refusal, `expected a refusal, got ${e}`);
      assert.match(`${e.message}\n${e.fixes.join('\n')}`, pattern);
      return true;
    },
  );
function asUser<T>(fn: () => T): T {
  const secret = randomBytes(16).toString('hex');
  mkdirSync(join(repo, '.git/cairn'), { recursive: true });
  writeFileSync(join(repo, '.git/cairn/mod-secret.sha256'), createHash('sha256').update(secret).digest('hex'), { mode: 0o600 });
  process.env.CAIRN_APPROVER = secret;
  try {
    return fn();
  } finally {
    delete process.env.CAIRN_APPROVER;
  }
}
const stateOf = (wt: string, slug: string) => JSON.parse(readFileSync(join(pd(wt, slug), 'state.json'), 'utf8'));
function edit(wt: string, slug: string, fn: (s: Record<string, any>) => void) {
  const f = join(pd(wt, slug), 'state.json');
  const s = JSON.parse(readFileSync(f, 'utf8'));
  fn(s);
  writeFileSync(f, JSON.stringify(s, null, 2));
}
const CORE = '---\narea: Core\nsummary: The core.\npaths:\n  - src/core/**\n---\n\n## Rules\n';
const SYSTEM = 'docs/cairn/system';
let n = 0;

/** A feature plan at learn with a valid record. Area docs on main come before the plan. */
function learnPlan(slug: string): string {
  const wt = ok(repo, 'new', slug, '--title', slug).data!.worktree as string;
  edit(wt, slug, (s) => (s.stage = 'learn'));
  copyFileSync(join(import.meta.dirname, '../../templates/record.md'), join(pd(wt, slug), 'RECORD.md'));
  commitAll(wt, 'plan files');
  return wt;
}
const withCore = () => {
  write(join(repo, SYSTEM, 'core.md'), CORE);
  commitAll(repo, 'area docs');
};
const slug = () => `p${++n}`;

before(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-area-')));
  g(repo, 'init', '-q', '-b', 'main');
  write(join(repo, 'README.md'), 'hi\n');
  commitAll(repo, 'init');
});
beforeEach(() => {
  // Each test starts from a main without area docs.
  g(repo, 'rm', '-rq', '--ignore-unmatch', SYSTEM);
  rmSync(join(repo, SYSTEM), { recursive: true, force: true });
  if (g(repo, 'status', '--porcelain')) commitAll(repo, 'reset area docs');
});
after(() => rmSync(repo, { recursive: true, force: true }));

test('no area docs: close passes and warns', () => {
  const s = slug();
  const wt = learnPlan(s);
  write(join(wt, 'src/core/a.ts'), '1\n');
  commitAll(wt, 'code');
  assert.match(ok(wt, 'close').message, /Closed/);
  assert.ok(stateOf(wt, s).log.some((e: { event: string; detail?: string }) => e.event === 'warning: close' && /cairn:map/.test(e.detail ?? '')));
});

test('covered change without doc update refuses', () => {
  withCore();
  const wt = learnPlan(slug());
  write(join(wt, 'src/core/a.ts'), '1\n');
  commitAll(wt, 'code');
  refused(wt, /core\.md covers files this plan changed \(src\/core\/a\.ts\)/, 'close');
});

test('doc update satisfies it', () => {
  withCore();
  const s = slug();
  const wt = learnPlan(s);
  write(join(wt, 'src/core/a.ts'), '1\n');
  write(join(wt, SYSTEM, 'core.md'), `${CORE}- a rule\n`);
  commitAll(wt, 'code and doc');
  ok(wt, 'close');
  assert.deepEqual(stateOf(wt, s).areasTouched, ['core']);
});

test('skip satisfies it', () => {
  withCore();
  const s = slug();
  const wt = learnPlan(s);
  write(join(wt, 'src/core/a.ts'), '1\n');
  commitAll(wt, 'code');
  ok(wt, 'area', 'skip', 'core', '--note', 'rename only');
  assert.equal(stateOf(wt, s).areaSkips[0].area, 'core');
  assert.match(g(wt, 'log', '-1', '--format=%s'), /area skip: core/);
  ok(wt, 'close');
});

test('uncovered files refuse, skip passes', () => {
  withCore();
  const wt = learnPlan(slug());
  write(join(wt, 'lib/x.ts'), '1\n');
  commitAll(wt, 'code');
  refused(wt, /belong to no area: lib\/x\.ts/, 'close');
  ok(wt, 'area', 'skip', '--uncovered', '--note', 'n');
  ok(wt, 'close');
});

test('bad frontmatter refuses naming the file', () => {
  write(join(repo, SYSTEM, 'bad.md'), '# no frontmatter\n');
  commitAll(repo, 'bad doc');
  const wt = learnPlan(slug());
  refused(wt, /system\/bad\.md has no frontmatter/, 'close');
});

test('missing base branch warns, no throw', () => {
  withCore();
  const s = slug();
  const wt = learnPlan(s);
  edit(wt, s, (st) => (st.base = 'gone'));
  ok(wt, 'close');
  assert.ok(stateOf(wt, s).log.some((e: { event: string; detail?: string }) => e.event === 'warning: close' && /could not compare with gone/.test(e.detail ?? '')));
});

test('fix track checks too', () => {
  withCore();
  const s = slug();
  const wt = ok(repo, 'new', s, '--track', 'fix', '--title', s).data!.worktree as string;
  write(join(wt, 'src/core/a.ts'), '1\n');
  edit(wt, s, (st) => Object.assign(st, { repro: { cmd: "true", tail: "", at: st.created }, stage: "ship", approvals: { ship: { at: st.created, via: 'human' } } }));
  commitAll(wt, 'fix');
  write(
    join(pd(wt, s), 'RECORD.md'),
    ['Links', 'Bug', 'Cause', 'Fix', 'Evidence'].map((h) => `## ${h}\n\n${Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ')}\n`).join('\n'),
  );
  commitAll(wt, 'record');
  refused(wt, /core\.md covers files this plan changed \(src\/core\/a\.ts\)/, 'advance');
  assert.equal(stateOf(wt, s).stage, 'ship');
});

test('area skip refuses unknown id and missing note', () => {
  withCore();
  const wt = learnPlan(slug());
  refused(wt, /no area/, 'area', 'skip', 'nope', '--note', 'x');
  refused(wt, /note/, 'area', 'skip', 'core');
  refused(wt, /note/, 'area', 'skip', '--uncovered');
});
