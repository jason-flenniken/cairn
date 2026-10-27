import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { Area } from '../src/areas.ts';
import type { PlanEntry } from '../src/commands/records.ts';
import { plansTouching } from '../src/memory.ts';
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
const CORE = '---\narea: Core\nsummary: The core.\npaths:\n  - src/core/**\n---\n\n## Rules\n\n- keep it small\n\n## History\n\nstale\n';
const SYSTEM = 'docs/cairn/system';

before(() => {
  for (const k of ['GIT_AUTHOR_NAME', 'GIT_COMMITTER_NAME']) process.env[k] = 't';
  for (const k of ['GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_EMAIL']) process.env[k] = 't@t';
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-publish-')));
  g(repo, 'init', '-q', '-b', 'main');
  write(join(repo, 'README.md'), 'hi\n');
  write(join(repo, SYSTEM, 'core.md'), CORE);
  commitAll(repo, 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

/** A plan at learn that records one lasting decision on `core` and updates core.md. */
function learnPlan(slug: string): string {
  const wt = run(['new', slug, '--title', `Plan ${slug}`], repo).data!.worktree as string;
  const f = join(pd(wt, slug), 'state.json');
  const s = JSON.parse(readFileSync(f, 'utf8'));
  s.stage = 'learn';
  writeFileSync(f, JSON.stringify(s, null, 2));
  copyFileSync(join(import.meta.dirname, '../../templates/record.md'), join(pd(wt, slug), 'RECORD.md'));
  run(['decide', 'Which store?', 'Use files', '--why', 'simple', '--lasting', '--areas', 'core'], wt);
  write(join(wt, 'src/core/a.ts'), '1\n');
  write(join(wt, SYSTEM, 'core.md'), `${CORE}- a rule\n`);
  commitAll(wt, 'work');
  return wt;
}

const area: Area = { id: 'core', name: 'Core', summary: 'The core.', paths: ['src/core/**'], file: `${SYSTEM}/core.md` };
const mkState = (slug: string, over: Partial<State> = {}): State =>
  ({ slug, title: `Plan ${slug}`, track: 'feature', stage: 'closed', created: '2026-01-01T00:00:00Z', branch: `feature/${slug}`, phases: [], approvals: {}, evidence: {}, drift: [], suggestions: [], log: [], ...over }) as State;
const entry = (slug: string, date: string, over: Partial<State> = {}, record?: string): PlanEntry => ({ state: mkState(slug, over), dir: `/x/${date}-${slug}`, date, record });

test('close writes the changelog and commits it, and doing it again changes nothing', () => {
  const wt = learnPlan('pub');
  run(['close'], wt);
  const md = readFileSync(join(wt, 'docs/cairn/OVERVIEW.md'), 'utf8');
  assert.match(md, /^# Changelog/);
  assert.match(md, /## \d{4}-\d{2}-\d{2} · Plan pub/);
  assert.doesNotMatch(md, /## Areas|## Decisions/);
  assert.match(g(wt, 'log', '-1', '--format=%s'), /update changelog/);
  assert.equal(g(wt, 'ls-tree', '--name-only', 'HEAD', 'docs/cairn/decisions/'), '', 'close no longer publishes decisions');
  assert.doesNotMatch(readFileSync(join(wt, SYSTEM, 'core.md'), 'utf8'), /Decision \[/);
  const before = g(wt, 'rev-parse', 'HEAD');
  run(['render'], wt);
  assert.equal(g(wt, 'status', '--porcelain', '--', 'docs/cairn/OVERVIEW.md'), '');
  assert.equal(g(wt, 'rev-parse', 'HEAD'), before);
});

test('every OVERVIEW record link resolves under the rendered root, even with an old-layout worktree', () => {
  const r = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-links-')));
  try {
    g(r, 'init', '-q', '-b', 'main');
    write(join(r, SYSTEM, 'core.md'), CORE);
    commitAll(r, 'init');
    const plan = (slug: string, areasTouched: string[]) => ({ ...mkState(slug, { areasTouched }), branch: `feature/${slug}`, base: 'main' });
    const put = (root: string, layout: string, slug: string, withRecord: boolean) => {
      const dir = join(root, layout, `2026-10-01-${slug}`);
      write(join(dir, 'state.json'), JSON.stringify(plan(slug, ['core'])));
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

test('plansTouching ignores ** scopes', () => {
  const task = (scope: string[]) => ({ id: 't', name: 't', covers: [], blockedBy: [], scope, complexity: 'standard', status: 'done', fixRound: 0 });
  const fix = entry('fix', '2026-01-01', { phases: [{ id: 'fix', name: 'Fix', status: 'done', tasks: [task(['**'])] }] as State['phases'] });
  const scoped = entry('scoped', '2026-01-02', { phases: [{ id: 'p', name: 'P', status: 'done', tasks: [task(['src/core/x.ts'])] }] as State['phases'] });
  const touched = entry('touched', '2026-01-03', { areasTouched: ['core'] });
  const other = entry('other', '2026-01-04', { areasTouched: ['lib'] });
  const open = entry('open', '2026-01-05', { stage: 'learn', areasTouched: ['core'] });
  assert.deepEqual(plansTouching(area, [fix, scoped, touched, other, open]).map((p) => p.state.slug), ['touched', 'scoped']);
});

test('render on main writes OVERVIEW.md, not INDEX.md', () => {
  run(['render'], repo);
  assert.ok(existsSync(join(repo, 'docs/cairn/OVERVIEW.md')));
  assert.ok(!existsSync(join(repo, 'docs/cairn/INDEX.md')));
  assert.match(readFileSync(join(repo, 'docs/cairn/OVERVIEW.md'), 'utf8'), /^# Changelog/);
});
