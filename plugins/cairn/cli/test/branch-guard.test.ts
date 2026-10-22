import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { run } from '../src/main.ts';
import { Refusal } from '../src/util.ts';
import { pd } from './plandir.ts';

let repo: string;
let wt: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const write = (p: string, s: string) => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, s);
};
const ok = (cwd: string, ...argv: string[]) => run(argv, cwd);
/** Act as the user through the mod: write the hash of a fresh mod secret and pass the secret as the mod does. */
function byUser(cwd: string, ...argv: string[]) {
  const secret = randomBytes(16).toString('hex');
  mkdirSync(join(repo, '.git/cairn'), { recursive: true });
  writeFileSync(join(repo, '.git/cairn/mod-secret.sha256'), createHash('sha256').update(secret).digest('hex'), { mode: 0o600 });
  process.env['CAIRN_' + 'APPROVER'] = secret;
  try {
    return ok(cwd, ...argv);
  } finally {
    delete process.env['CAIRN_' + 'APPROVER'];
  }
}
/** Commit one file on the task's own branch, in its worktree. */
const commitOnTask = (dir: string, file: string) => {
  write(join(dir, file), 'x\n');
  g(dir, 'add', '-A');
  g(dir, 'commit', '-q', '-m', `add ${file}`);
};

const PRD = `# PRD
## Problem
p
## Solution
s
## Requirements
- **FR-01** a. Check: a
- **FR-02** b. Check: b
- **FR-03** c. Check: c
## Non-goals
- none
## Open questions
- [x] none
`;
const PLAN = `## Goal
g
## Architecture
a
## Phases
\`\`\`yaml cairn-tasks
phases:
  - id: core
    name: Core
    tasks:
      - { id: a, name: A, covers: [FR-01], scope: ["src/a/**"] }
      - { id: b, name: B, covers: [FR-02], scope: ["src/b/**"] }
      - { id: c, name: C, covers: [FR-03], scope: ["docs/**"] }
\`\`\`
`;

before(() => {
  process.env.GIT_AUTHOR_NAME = 't';
  process.env.GIT_AUTHOR_EMAIL = 't@t';
  process.env.GIT_COMMITTER_NAME = 't';
  process.env.GIT_COMMITTER_EMAIL = 't@t';
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-guard-')));
  g(repo, 'init', '-q', '-b', 'main');
  write(join(repo, 'README.md'), 'hi\n');
  write(join(repo, '.sdlc/config.json'), JSON.stringify({ maxParallel: 3 }));
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
});
after(() => rmSync(repo, { recursive: true, force: true }));

test('task done refuses plan-branch commits inside the task scope, and only those', () => {
  wt = ok(repo, 'new', 'guard', '--title', 'Guard').data!.worktree as string;
  const dir = pd(wt, 'guard');
  ok(wt, 'decide', 'Q?', 'A', '--why', 'w');
  ok(wt, 'advance');
  write(join(dir, 'prd.md'), PRD);
  byUser(wt, 'approve', 'prd');
  ok(wt, 'advance');
  write(join(dir, 'plan.md'), PLAN);
  ok(wt, 'plan', 'load');
  byUser(wt, 'approve', 'plan');
  ok(wt, 'advance');
  const wa = ok(wt, 'task', 'start', 'a').data!.worktree as string;
  const wb = ok(wt, 'task', 'start', 'b').data!.worktree as string;
  const wc = ok(wt, 'task', 'start', 'c').data!.worktree as string;

  // The implementer for task a commits straight onto the plan branch.
  write(join(wt, 'src/a/stray.ts'), 'x\n');
  g(wt, 'add', '-A');
  g(wt, 'commit', '-q', '-m', 'stray');
  const stray = g(wt, 'rev-parse', '--short', 'HEAD');
  // A state-style commit under docs/sdlc on the plan branch is not a stray.
  write(join(dir, 'notes.md'), 'n\n');
  g(wt, 'add', '-A');
  g(wt, 'commit', '-q', '-m', 'state');

  // b: a normal task branch merged with --no-ff passes, and a's stray commit (outside b's scope) does not trigger it.
  commitOnTask(wb, 'src/b/index.ts');
  g(wt, 'merge', '-q', '--no-ff', '-m', 'merge b', 'task/guard/b');
  ok(wt, 'task', 'done', 'b');

  // c: its scope covers docs/, yet the docs/sdlc commit is ignored.
  commitOnTask(wc, 'docs/c.md');
  g(wt, 'merge', '-q', '--no-ff', '-m', 'merge c', 'task/guard/c');
  ok(wt, 'task', 'done', 'c');

  // a: the stray commit in scope is refused, named, with the fix.
  commitOnTask(wa, 'src/a/index.ts');
  g(wt, 'merge', '-q', '--no-ff', '-m', 'merge a', 'task/guard/a');
  assert.throws(
    () => ok(wt, 'task', 'done', 'a'),
    (e: unknown) => e instanceof Refusal && e.message.includes(stray) && /directly on feature\/guard/.test(e.message) && e.fixes.some((f) => /move these commits to the task branch/.test(f)),
  );
});
