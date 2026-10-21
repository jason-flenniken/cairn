import './no-auto-gc.ts';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CliError } from '../src/util.ts';
import { parseArgs, run } from '../src/main.ts';

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

// A plan at the prd stage with a valid PRD, as the approval tests need.
const PRD = '# P\n## Problem\np\n## Solution\ns\n## User stories\n1. u\n## Requirements\n- FR-01 a\n## Non-functional requirements\n- NFR-01 b\n## Non-goals\n- c\n## Acceptance criteria\n- FR-01 d\n## Unhappy paths\n- FR-01 e\n## Security considerations\n- f\n## Open questions\n- [x] g\n';

let main: string;
let wt: string;
let inputs: string;
const mainCairn = () => join(main, '.git', 'cairn');
const hashFile = () => join(mainCairn(), 'mod-secret.sha256');
const planState = () => JSON.parse(readFileSync(join(wt, 'docs/sdlc/plans/billing/state.json'), 'utf8'));
const decisions = () => readFileSync(join(wt, 'docs/sdlc/plans/billing/decisions.md'), 'utf8');

/** Store the hash of a known secret, as the mod does, and expose the secret to this process. */
const setSecret = (v: string) => {
  mkdirSync(mainCairn(), { recursive: true });
  writeFileSync(hashFile(), sha256(v), { mode: 0o600 });
  process.env.CAIRN_APPROVER = v;
};

/** Run the real CLI entry point in a child process and return its exit code and output. */
const cli = (args: string[], cwd: string) => {
  const r = spawnSync(process.execPath, [MAIN, ...args], { cwd, env, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

before(() => {
  for (const k of ['GIT_AUTHOR_NAME', 'GIT_COMMITTER_NAME']) process.env[k] = 't';
  for (const k of ['GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_EMAIL']) process.env[k] = 't@t';
  main = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-fileinput-main-')));
  inputs = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-fileinput-in-')));
  g(main, 'init', '-q', '-b', 'main');
  writeFileSync(join(main, 'README.md'), 'hi\n');
  g(main, 'add', '-A');
  g(main, 'commit', '-q', '-m', 'init');
  wt = run(['new', 'billing', '--title', 'Billing'], main).data!.worktree as string;
  run(['decide', 'q', 'a'], wt);
  run(['advance'], wt);
  writeFileSync(join(wt, 'docs/sdlc/plans/billing/prd.md'), PRD);
});
after(() => {
  rmSync(main, { recursive: true, force: true });
  rmSync(inputs, { recursive: true, force: true });
});
afterEach(() => {
  delete process.env.CAIRN_APPROVER;
  rmSync(mainCairn(), { recursive: true, force: true });
});

test('an answer with an apostrophe given through --file is recorded verbatim', () => {
  const file = join(inputs, 'apostrophe.json');
  writeFileSync(file, JSON.stringify({ question: 'Which name?', answer: "Don't rename the 'billing' module", why: "It's the team's term" }));
  const r = run(['decide', '--file', file], wt);
  assert.equal(r.message, "Recorded decision 2: Don't rename the 'billing' module");
  assert.match(decisions(), /### 2\. Which name\?\n\*\*Decision:\*\* Don't rename the 'billing' module\n\*\*Why:\*\* It's the team's term\n/);
});

test('--note-file on approve records the file contents as the approval note', () => {
  setSecret('s3cret');
  const file = join(inputs, 'approve-note.txt');
  const note = "Approved. Don't ship the \"legacy\" flow.\n";
  writeFileSync(file, note);
  run(['approve', 'prd', '--note-file', file], wt);
  assert.equal(planState().approvals.prd.note, note);
});

test('--note-file on evidence records the file contents as the evidence note', () => {
  // The plan is not at the verify stage, so the user's proof is also the override that lets this through.
  setSecret('again');
  const file = join(inputs, 'evidence-note.txt');
  const note = "Tests pass; the user's manual check passed too.\n";
  writeFileSync(file, note);
  run(['evidence', 'verify', 'pass', '--override', 'user checked it', '--note-file', file], wt);
  assert.equal(planState().evidence.verify.note, note);
});

test('a missing --note-file exits 1 and names the file', () => {
  const missing = join(inputs, 'no-such-note.txt');
  assert.throws(
    () => parseArgs(['status', '--note-file', missing], wt),
    (e: unknown) => e instanceof CliError && e.message.includes(missing),
  );
  const r = cli(['status', '--note-file', missing], wt);
  assert.equal(r.status, 1);
  assert.match(r.out, /no-such-note\.txt/);
});

test('a missing --file exits 1 and names the file', () => {
  const missing = join(inputs, 'no-such-decision.json');
  const r = cli(['decide', '--file', missing], wt);
  assert.equal(r.status, 1);
  assert.match(r.out, /no-such-decision\.json/);
});

test('invalid JSON in --file exits 1 and names the file', () => {
  const bad = join(inputs, 'broken-decision.json');
  writeFileSync(bad, '{"question": "Q", "answer": ');
  const r = cli(['decide', '--file', bad], wt);
  assert.equal(r.status, 1);
  assert.match(r.out, /broken-decision\.json/);
});

test('a relative path resolves from the current directory, with no shell expansion', () => {
  // A directory literally named $HOME: a shell would expand it, Node does not.
  mkdirSync(join(wt, '$HOME'), { recursive: true });
  writeFileSync(join(wt, '$HOME', 'relative.json'), JSON.stringify({ question: 'Relative?', answer: 'Read from cwd' }));
  const before = decisions();
  run(['decide', '--file', '$HOME/relative.json'], wt);
  assert.match(decisions(), /### \d+\. Relative\?\n\*\*Decision:\*\* Read from cwd\n/);
  assert.notEqual(decisions(), before);
  assert.equal(parseArgs(['status', '--note-file', '$HOME/relative.json'], wt).opts.note, JSON.stringify({ question: 'Relative?', answer: 'Read from cwd' }));
});
