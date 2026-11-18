import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { taskBranch } from '../src/locate.ts';
import { pluginRoot } from '../src/util.ts';

const root = pluginRoot();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const FIX_SECTIONS = ['Links', 'Bug', 'Cause', 'Fix', 'Evidence'];

test('the fix record template has the five sections in order', () => {
  const headings = [...read('templates/record-fix.md').matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  assert.deepEqual(headings, FIX_SECTIONS);
});

test('the fix skill is user-invoked only and runs cairn commands', () => {
  const skill = read('skills/fix/SKILL.md');
  assert.match(skill, /^name: fix$/m);
  assert.match(skill, /^disable-model-invocation: true$/m);
  assert.match(skill, /^\s+- "Bash\(cairn status:\*\)"\s*$/m);
  assert.doesNotMatch(skill, /cairn:\*/);
  assert.doesNotMatch(skill, /cairn repro/);
  assert.match(skill, /\$\{CLAUDE_PLUGIN_ROOT\}\/procedures\/fix\.md/);
  assert.match(skill, /Procedure files are not variable-expanded/);
});

test('fix.md has no approval step: it opens the pull request, waits, and sends the user to the Merge section', () => {
  const src = read('procedures/fix.md');
  assert.doesNotMatch(src, /\[cairn:approve|cairn approve|Approve \(Recommended\)/);
  assert.match(src, /cairn step opening-pr && cairn pr open/);
  assert.match(src, /cairn advance[\s\S]*cairn pr open/);
});

test('fix.md decides a fix past the file limit with --call, and keeps new requirements out', () => {
  const src = read('procedures/fix.md');
  assert.match(src, /cairn escalate/);
  assert.match(src, /task done/);
  assert.match(src, /--call "/);
  assert.doesNotMatch(src, /AskUserQuestion/);
});

test('fix.md asks for a better repro when the repro command exits 0', () => {
  assert.match(read('procedures/fix.md'), /exits 0[\s\S]*better repro/);
});

test('fix.md never pre-approves the repro command', () => {
  const src = read('procedures/fix.md');
  assert.doesNotMatch(src, /Bash\(cairn repro/);
  assert.doesNotMatch(src, /allowed-tools/);
  assert.doesNotMatch(src, /pre-?approv/i);
  for (const line of src.split('\n')) {
    if (!/repro/.test(line)) continue;
    assert.doesNotMatch(line, /\ballow/i, `repro line mentions an allow list: "${line.trim()}"`);
  }
});

test('fix.md step 6 hands the reviewer the bug and repro, not prd.md or plan.md', () => {
  const src = read('procedures/fix.md');
  const start = src.indexOf('## 6. Review');
  const end = src.indexOf('## 7.');
  assert.ok(start >= 0 && end > start, 'step 6 is present');
  const step = src.slice(start, end);
  assert.doesNotMatch(step, /prd\.md|plan\.md/);
  assert.match(step, /state\.repro/);
  assert.match(step, /bug title/);
});

test('fix.md step 6 fixes blocking findings in place with two attempts and records what is left as not done', () => {
  const src = read('procedures/fix.md');
  const step = src.slice(src.indexOf('## 6. Review'), src.indexOf('## 7.'));
  assert.doesNotMatch(step, /AskUserQuestion/);
  assert.match(step, /Fix them in place, without asking/);
  assert.match(step, /two fix attempts/);
  assert.match(step, /cairn advance --not-done "/);
  assert.doesNotMatch(step, /fix each blocking finding in a fix task/i);
});

test('fix.md names the fix task, its folder and its branch the way tasks.ts does', () => {
  const src = read('procedures/fix.md');
  const tasks = read('cli/src/commands/tasks.ts');
  const stages = read('cli/src/commands/stages.ts');
  assert.equal(taskBranch('my-plan', 'fix'), 'task/my-plan/fix');
  assert.ok(src.includes('`task/<slug>/fix`'), 'fix.md names the branch task/<slug>/fix');
  assert.ok(tasks.includes('const branch = taskBranch(plan.slug, id);'), 'tasks.ts names the branch with taskBranch');
  assert.ok(src.includes('`<plan worktree folder>--fix`'), 'fix.md names the folder <plan worktree folder>--fix');
  assert.ok(tasks.includes('`${basename(plan.worktree)}--${id}`'), 'tasks.ts names the folder <plan worktree folder>--<task id>');
  assert.match(stages, /tasks: \[\{ id: 'fix', name: 'Fix'/, 'advance creates the single task with id fix');
  assert.ok(src.includes('creates the single task `fix`'), 'fix.md says advance creates the task fix');
});
