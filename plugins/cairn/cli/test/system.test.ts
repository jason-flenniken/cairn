import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { context } from '../src/locate.ts';
import { cmdSystem, readStamp, sourceDirs, stampLine, systemBrief, systemLine, SYSTEM_REL } from '../src/commands/system.ts';
import { hookSessionStart } from '../src/commands/hooks.ts';
import { pluginRoot } from '../src/util.ts';

const dirs: string[] = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function put(root: string, rel: string, text: string) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function commit(root: string, msg: string) {
  sh(root, 'add', '-A');
  sh(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', msg);
  return sh(root, 'rev-parse', '--short', 'HEAD');
}

function repo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-system-')));
  dirs.push(root);
  sh(root, 'init', '-q', '-b', 'main');
  put(root, 'README.md', '# App\n\n## Install\n\n## Usage\n');
  put(root, 'src/a.ts', 'a');
  put(root, 'src/b.ts', 'b');
  put(root, 'src/api/x.ts', 'x');
  put(root, 'src/api/y.ts', 'y');
  put(root, 'test/a.test.ts', 't');
  put(root, 'test/b.test.ts', 't');
  put(root, 'dist/out.js', 'o');
  put(root, 'dist/out2.js', 'o');
  commit(root, 'initial');
  return root;
}

const overview = (sha: string, body = 'src/api handles requests. src/a.ts starts it.') => `# System overview\n${stampLine(sha, '2026-11-17')}\nGenerated.\n\n${body}\n`;

test('the stamp round-trips and is found in the first lines', () => {
  assert.deepEqual(readStamp(overview('abc1234')), { sha: 'abc1234', date: '2026-11-17' });
  assert.equal(readStamp('# no stamp'), undefined);
});

test('source folders hold two or more files directly and skip tests, docs and generated output', () => {
  assert.deepEqual(sourceDirs(['src/a.ts', 'src/b.ts', 'src/one/x.ts', 'test/a.ts', 'test/b.ts', 'dist/a', 'dist/b', 'docs/a.md', 'docs/b.md', 'top.md', 'top2.md']), ['src']);
});

test('with no overview the brief is a full rebuild with every source folder as a gap', () => {
  const root = repo();
  const b = systemBrief(context(root));
  assert.equal(b.full, true);
  assert.equal(b.why, 'no overview yet');
  assert.equal(b.exists, false);
  assert.deepEqual(b.gaps, ['src', 'src/api']);
  assert.deepEqual(b.readmeHeadings, ['Install', 'Usage']);
  assert.deepEqual(b.commits, []);
  assert.equal(systemLine(root), '');
});

test('a stamped overview lists only what changed since, and folders it names are not gaps', () => {
  const root = repo();
  const base = commit((put(root, SYSTEM_REL, overview(sh(root, 'rev-parse', '--short', 'HEAD'))), root), 'overview');
  assert.equal(cmdSystem(context(root), {}).data?.current, true, 'committing only the overview keeps it current');

  put(root, 'src/api/z.ts', 'z');
  commit(root, 'add z endpoint');
  put(root, 'lib/m.ts', 'm');
  put(root, 'lib/n.ts', 'n');
  commit(root, 'add lib');

  const b = systemBrief(context(root));
  assert.equal(b.full, false);
  assert.equal(b.behind, 2);
  assert.deepEqual(b.commits.map((c) => c.replace(/^\w+ /, '')), ['add lib', 'add z endpoint']);
  assert.deepEqual(b.changed.sort(), ['lib/m.ts', 'lib/n.ts', 'src/api/z.ts']);
  assert.deepEqual(b.gaps, ['lib']);
  assert.notEqual(base, b.head);
  assert.match(systemLine(root), /system overview \(docs\/cairn\/SYSTEM\.md\) is 2 commits behind; \/cairn:system refreshes it/);
  assert.match(hookSessionStart({ cwd: root }), /is 2 commits behind/);
});

test('--full and a stamp gone from history both rebuild everything', () => {
  const root = repo();
  put(root, SYSTEM_REL, overview('deadbee'));
  commit(root, 'overview');
  const b = systemBrief(context(root));
  assert.equal(b.full, true);
  assert.match(b.why, /deadbee is no longer/);
  assert.equal(systemLine(root), '');

  put(root, SYSTEM_REL, overview(sh(root, 'rev-parse', '--short', 'HEAD')));
  commit(root, 'overview again');
  assert.equal(systemBrief(context(root), true).full, true);
  assert.equal(cmdSystem(context(root), { full: true }).data?.current, false);
});

test('the skill, procedure and writer agent agree on the contract', () => {
  const read = (rel: string) => readFileSync(join(pluginRoot(), rel), 'utf8');
  assert.match(read('skills/system/SKILL.md'), /procedures\/system\.md/);
  const proc = read('procedures/system.md');
  for (const t of ['cairn system --json', '--full', 'system-writer', 'model: "sonnet"', 'not committed']) assert.ok(proc.includes(t), `procedure mentions ${t}`);
  const agent = read('agents/system-writer.md');
  assert.match(agent, /^model: sonnet$/m);
  for (const t of ['stampLine', '1,500 words', 'never from the folder tree', 'mermaid', 'Start here', 'only the sections']) assert.ok(agent.includes(t), `agent mentions ${t}`);
});
