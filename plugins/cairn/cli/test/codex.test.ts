import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { hookPreTool, hookSessionStart, patchPaths } from '../src/commands/hooks.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const json = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const denied = (out: string) => (out ? JSON.parse(out).hookSpecificOutput : undefined);

// ---------- Packaging ----------

test('the Codex manifest matches the Claude one, and its hooks file only uses keys Codex accepts', () => {
  const claude = json('.claude-plugin/plugin.json');
  const codex = json('.codex-plugin/plugin.json');
  assert.equal(codex.name, claude.name);
  assert.equal(codex.version, claude.version, 'Codex caches by version too: bump both');
  assert.equal(codex.skills, './skills/');
  assert.equal(codex.hooks, './hooks/codex-hooks.json', 'an explicit path keeps Codex off hooks.json and its mod modules');
  const hooks = json('hooks/codex-hooks.json');
  assert.deepEqual(Object.keys(hooks).sort(), ['description', 'hooks']);
  const commands = Object.values(hooks.hooks as Record<string, { hooks: { command: string }[] }[]>).flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)));
  for (const c of commands) assert.match(c, /^"\$\{PLUGIN_ROOT\}\/bin\/cairn" hook (session-start|pre-tool|post-edit)$/);
});

test('every skill tells a host without Claude Code where the plugin root and the CLI are', () => {
  for (const name of readdirSync(join(ROOT, 'skills'))) {
    const body = readFileSync(join(ROOT, 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(body, /^Plugin root: `\$\{CLAUDE_PLUGIN_ROOT\}`\. If that shows a `\$\{…\}` placeholder/m, name);
    assert.match(body, /<plugin root>\/bin\/cairn/, name);
    assert.match(body, /references\/hosts\.md/, name);
  }
});

// ---------- Guard ----------

test('pre-tool refuses the approvals and state writes the mod refuses', () => {
  const bash = (command: string) => denied(hookPreTool({ tool_name: 'Bash', tool_input: { command } }));
  assert.equal(bash('cairn approve plan --human')?.permissionDecision, 'deny');
  assert.match(bash('cairn approve plan --human')!.permissionDecisionReason, /run in their own terminal/);
  assert.equal(bash('CAIRN_APPROVER=x cairn advance')?.permissionDecision, 'deny');
  assert.equal(bash('script -q /dev/null cairn approve ship --human')?.permissionDecision, 'deny');
  assert.equal(bash('echo {} > docs/cairn/plans/2026-01-01-x/state.json')?.permissionDecision, 'deny');
  assert.equal(hookPreTool({ tool_name: 'Bash', tool_input: { command: ['cairn', 'approve', 'prd', '--human'] } }) !== '', true, 'an argv array is read too');
  for (const full of ['"/opt/x/bin/cairn" approve plan --human', 'node /opt/x/dist/cairn.mjs approve ship --human', 'cd /w && "/opt/x/bin/cairn" level mvp --human'])
    assert.equal(bash(full)?.permissionDecision, 'deny', `the full-path spelling Codex uses: ${full}`);
  assert.equal(bash('cairn status --json'), undefined);
  assert.equal(bash('npm test'), undefined);
});

test('pre-tool refuses an apply_patch that writes plan state or cairn\'s folder, through a symlink too', () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-codex-')));
  mkdirSync(join(d, 'docs/cairn/plans/2026-01-01-x'), { recursive: true });
  symlinkSync(join(d, 'docs/cairn/plans/2026-01-01-x'), join(d, 'link'));
  const patch = (path: string) => hookPreTool({ cwd: d, tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Update File: ${path}\n@@\n-a\n+b\n*** End Patch` } });
  assert.equal(denied(patch('docs/cairn/plans/2026-01-01-x/state.json'))?.permissionDecision, 'deny');
  assert.equal(denied(patch('link/state.json'))?.permissionDecision, 'deny', 'a symlink is followed to where the write lands');
  assert.equal(denied(patch('.git/cairn/secret'))?.permissionDecision, 'deny');
  assert.equal(denied(patch('~/x'))?.permissionDecision, 'deny', 'a path that cannot be placed is refused');
  assert.equal(patch('docs/cairn/plans/2026-01-01-x/prd.md'), '');
  assert.equal(patch('src/a.ts'), '');
});

test('patchPaths lists added, updated, deleted and moved-to files once each', () => {
  const p = '*** Begin Patch\n*** Add File: a.ts\n+x\n*** Delete File: b.ts\n*** Update File: c.ts\n*** Move to: d.ts\n*** Update File: a.ts\n*** End Patch';
  assert.deepEqual(patchPaths(p), ['a.ts', 'b.ts', 'c.ts', 'd.ts']);
});

test('the bundled pre-tool hook refuses through the bin launcher and stays quiet on an allowed call', () => {
  const bin = join(ROOT, 'bin', 'cairn');
  const run = (input: string) => spawnSync(bin, ['hook', 'pre-tool'], { input, encoding: 'utf8' });
  const allowed = run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }));
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stdout, '');
  const refused = run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'cairn approve plan --human' } }));
  assert.equal(JSON.parse(refused.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

// ---------- Session start ----------

test('in Codex, session start names the CLI by its full path; in Claude Code it adds nothing', () => {
  const d = mkdtempSync(join(tmpdir(), 'cairn-codex-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: d });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: d });
  const prev = process.env.PLUGIN_ROOT;
  try {
    delete process.env.PLUGIN_ROOT;
    assert.equal(hookSessionStart({ cwd: d }), '');
    process.env.PLUGIN_ROOT = '/opt/codex/cairn/0.18.0';
    const text = JSON.parse(hookSessionStart({ cwd: d })).hookSpecificOutput.additionalContext;
    assert.match(text, /cairn CLI here: \/opt\/codex\/cairn\/0\.18\.0\/bin\/cairn/);
    assert.match(text, /references\/hosts\.md/);
  } finally {
    if (prev === undefined) delete process.env.PLUGIN_ROOT;
    else process.env.PLUGIN_ROOT = prev;
  }
});
