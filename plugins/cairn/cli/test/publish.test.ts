import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { run } from '../src/main.ts';
import type { State } from '../src/types.ts';
import { pd } from './plandir.ts';

let repo: string;
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const write = (p: string, s: string) => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, s);
};
const commitAll = (cwd: string, msg: string) => {
  g(cwd, 'add', '-A');
  g(cwd, 'commit', '-q', '-m', msg);
};

before(() => {
  for (const k of ['GIT_AUTHOR_NAME', 'GIT_COMMITTER_NAME']) process.env[k] = 't';
  for (const k of ['GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_EMAIL']) process.env[k] = 't@t';
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-publish-')));
  g(repo, 'init', '-q', '-b', 'main');
  write(join(repo, 'README.md'), 'hi\n');
  commitAll(repo, 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

const edit = (wt: string, slug: string, fn: (s: Record<string, any>) => void) => {
  const f = join(pd(wt, slug), 'state.json');
  const st = JSON.parse(readFileSync(f, 'utf8'));
  fn(st);
  writeFileSync(f, JSON.stringify(st, null, 2));
};

/** A feature plan at learn with a valid record and a code change. */
function learnPlan(slug: string, root = repo): string {
  const wt = run(['new', slug, '--title', `Plan ${slug}`], root).data!.worktree as string;
  edit(wt, slug, (s) => (s.stage = 'learn'));
  copyFileSync(join(import.meta.dirname, '../../templates/record.md'), join(pd(wt, slug), 'RECORD.md'));
  run(['decide', 'Which store?', 'Use files', '--why', 'simple'], wt);
  write(join(wt, 'src/core/a.ts'), '1\n');
  commitAll(wt, 'work');
  return wt;
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
/** A fix plan at ship with a repro, an approved ship, a valid fix record and a code change. */
function shipFix(slug: string, root = repo): string {
  const wt = run(['new', slug, '--track', 'fix', '--title', `Fix ${slug}`], root).data!.worktree as string;
  edit(wt, slug, (s) => Object.assign(s, { stage: 'ship', repro: { cmd: 'true', tail: '', at: s.created }, approvals: { ship: { at: s.created, via: 'human' } } }));
  write(join(pd(wt, slug), 'RECORD.md'), ['Links', 'Bug', 'Cause', 'Fix', 'Evidence'].map((h) => `## ${h}\n${words(10)}\n`).join('\n'));
  write(join(wt, 'src/core/b.ts'), '1\n');
  commitAll(wt, 'work');
  return wt;
}

const mkState = (slug: string, over: Partial<State> = {}): State =>
  ({ slug, title: `Plan ${slug}`, track: 'feature', stage: 'closed', created: '2026-01-01T00:00:00Z', branch: `feature/${slug}`, phases: [], approvals: {}, evidence: {}, drift: [], suggestions: [], log: [], ...over }) as State;

test('closing a feature plan writes and commits the changelog, and doing it again changes nothing', () => {
  const wt = learnPlan('pub');
  run(['close'], wt);
  const md = readFileSync(join(wt, 'docs/cairn/OVERVIEW.md'), 'utf8');
  assert.match(md, /^# Changelog/);
  assert.match(md, /## \d{4}-\d{2}-\d{2} · Plan pub/);
  assert.match(g(wt, 'log', '-1', '--format=%s'), /update changelog/);
  assert.ok(!existsSync(join(wt, 'docs/cairn/decisions')), 'close creates no decisions folder');
  const before = g(wt, 'rev-parse', 'HEAD');
  run(['render'], wt);
  assert.equal(g(wt, 'status', '--porcelain', '--', 'docs/cairn/OVERVIEW.md'), '');
  assert.equal(g(wt, 'rev-parse', 'HEAD'), before);
});

test('closing a fix plan through advance writes OVERVIEW and creates no decisions folder', () => {
  const wt = shipFix('fixpub');
  run(['advance'], wt);
  assert.equal(JSON.parse(readFileSync(join(pd(wt, 'fixpub'), 'state.json'), 'utf8')).stage, 'closed');
  assert.match(readFileSync(join(wt, 'docs/cairn/OVERVIEW.md'), 'utf8'), /· Fix fixpub/);
  assert.ok(!existsSync(join(wt, 'docs/cairn/decisions')));
  assert.match(g(wt, 'log', '-1', '--format=%s'), /update changelog/);
});

test('every OVERVIEW record link resolves under the rendered root, even with an old-layout worktree', () => {
  const r = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-links-')));
  try {
    g(r, 'init', '-q', '-b', 'main');
    write(join(r, 'README.md'), 'hi\n');
    commitAll(r, 'init');
    const plan = (slug: string) => ({ ...mkState(slug), branch: `feature/${slug}`, base: 'main' });
    const put = (root: string, layout: string, slug: string, withRecord: boolean) => {
      const dir = join(root, layout, `2026-10-01-${slug}`);
      write(join(dir, 'state.json'), JSON.stringify(plan(slug)));
      if (withRecord) write(join(dir, 'RECORD.md'), `# ${slug}\n\n## Why\n\nBecause ${slug}.\n`);
    };
    // "both": its record is on main under docs/cairn, but an old worktree still holds it under docs/sdlc.
    // "only-old": the record exists only in the old worktree, so the checkout being rendered has no file to link.
    put(r, 'docs/cairn/plans', 'both', true);
    commitAll(r, 'main plans');
    for (const slug of ['both', 'only-old']) {
      const wt = join(r, '..', `${slug}-${process.pid}`);
      g(r, 'worktree', 'add', '-q', '-b', `feature/${slug}`, wt, 'main');
      put(wt, 'docs/sdlc/plans', slug, true);
      g(wt, 'rm', '-rq', 'docs/cairn/plans');
      commitAll(wt, 'old layout');
    }
    run(['render'], r);
    const check = (rel: string) => {
      const md = readFileSync(join(r, rel), 'utf8');
      const links = [...md.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
      for (const l of links) assert.ok(existsSync(join(r, rel, '..', l)), `${rel} links to ${l}, which does not exist`);
      assert.doesNotMatch(md, /docs\/sdlc/);
      return md;
    };
    const md = check('docs/cairn/OVERVIEW.md');
    assert.match(md, /\[Record\]\(plans\/2026-10-01-both\/RECORD\.md\)/);
    assert.match(md, /## 2026-10-01 · Plan only-old\n/);
    assert.doesNotMatch(md, /only-old\/RECORD/);
  } finally {
    for (const slug of ['both', 'only-old']) {
      try {
        g(r, 'worktree', 'remove', '--force', join(r, '..', `${slug}-${process.pid}`));
      } catch {
        // already gone
      }
    }
    rmSync(r, { recursive: true, force: true });
  }
});

test('render on main writes OVERVIEW.md, not INDEX.md', () => {
  run(['render'], repo);
  assert.ok(existsSync(join(repo, 'docs/cairn/OVERVIEW.md')));
  assert.ok(!existsSync(join(repo, 'docs/cairn/INDEX.md')));
  assert.match(readFileSync(join(repo, 'docs/cairn/OVERVIEW.md'), 'utf8'), /^# Changelog/);
});

test('closing leaves old area docs and decision files byte-identical and warns about nothing', () => {
  const r = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-old-')));
  try {
    g(r, 'init', '-q', '-b', 'main');
    const area = '---\narea: Core\nsummary: The core.\npaths:\n  - src/core/**\n---\n\n## Rules\n\n- keep it small\n\n## History\n\nstale\n';
    const dec = '---\nid: x\nareas: [core]\n---\n\nUse files.\n';
    write(join(r, 'docs/cairn/system/a.md'), area);
    write(join(r, 'docs/cairn/decisions/x.md'), dec);
    write(join(r, 'README.md'), 'hi\n');
    commitAll(r, 'init');
    // src/core/a.ts changes code the old area check flagged; a.md is not touched.
    const wt = learnPlan('oldrepo', r);
    const out = run(['close'], wt);
    assert.doesNotMatch(out.message, /area|Warning/i);
    assert.equal(readFileSync(join(wt, 'docs/cairn/system/a.md'), 'utf8'), area);
    assert.equal(readFileSync(join(wt, 'docs/cairn/decisions/x.md'), 'utf8'), dec);
    assert.equal(g(wt, 'status', '--porcelain', '--', 'docs/cairn/system', 'docs/cairn/decisions'), '');
    assert.deepEqual(g(wt, 'ls-files', 'docs/cairn/decisions').split('\n'), ['docs/cairn/decisions/x.md']);
    const fx = shipFix('oldfix', r);
    run(['advance'], fx);
    assert.equal(readFileSync(join(fx, 'docs/cairn/system/a.md'), 'utf8'), area);
    assert.equal(readFileSync(join(fx, 'docs/cairn/decisions/x.md'), 'utf8'), dec);
  } finally {
    rmSync(r, { recursive: true, force: true });
  }
});

test('a state file with the old lasting, areaSkips and areasTouched fields loads and closes without publishing', () => {
  const wt = learnPlan('legacy');
  edit(wt, 'legacy', (s) => {
    s.lasting = [{ n: 1, question: 'Which store?', answer: 'Use files', areas: ['core'], paths: [], at: s.created }];
    s.areaSkips = [{ area: 'core', note: 'n', at: s.created }];
    s.areasTouched = ['core'];
  });
  commitAll(wt, 'old fields');
  run(['close'], wt);
  assert.ok(!existsSync(join(wt, 'docs/cairn/decisions')));
  assert.ok(!existsSync(join(wt, 'docs/cairn/system')));
  assert.equal(JSON.parse(readFileSync(join(pd(wt, 'legacy'), 'state.json'), 'utf8')).stage, 'closed');
});
