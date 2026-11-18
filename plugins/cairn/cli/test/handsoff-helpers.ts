import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadState, saveState } from '../src/state.ts';
import { pd } from './plandir.ts';

/** Record that the plan's pull request is open, as `cairn pr open` does, for tests that only need the plan at the merge stage. */
export function setPullRequest(wt: string, slug: string, draft = false): void {
  const dir = pd(wt, slug);
  const s = loadState(dir);
  s.pullRequest = { url: 'https://example.test/pull/1', draft, at: new Date().toISOString(), head: 'abc' };
  saveState(dir, s);
}

/**
 * A fake `gh` on PATH: `pr create` prints a URL and records its args in `<dir>/gh.log` (one line per call, newlines in an argument shown as ~); `pr view` fails (no open pull request)
 * unless FAKE_PR_VIEW is set, which it then prints as `<url> <isDraft> <state>`; every other `gh` call succeeds silently. Returns the log path and a restore function.
 */
export function fakeGh(): { dir: string; log: string; restore: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-gh-'));
  const log = join(dir, 'gh.log');
  const script = `#!/bin/sh
printf '%s ' "$@" | tr '\\n' '~' >> "${log}"; echo >> "${log}"
case "$1 $2" in
  "pr create") echo "https://example.test/pull/7" ;;
  "pr view") if [ -n "$FAKE_PR_VIEW" ]; then echo "$FAKE_PR_VIEW"; else exit 1; fi ;;
esac
exit 0
`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'gh'), script);
  chmodSync(join(dir, 'gh'), 0o755);
  const before = process.env.PATH;
  process.env.PATH = `${dir}:${before}`;
  return { dir, log, restore: () => void (process.env.PATH = before) };
}

/** Give a repo an `origin` that `git push` can reach: a bare repo in a tmp dir. */
export function addOrigin(repo: string): string {
  const bare = mkdtempSync(join(tmpdir(), 'cairn-origin-'));
  execFileSync('git', ['init', '-q', '--bare', bare]);
  const have = execFileSync('git', ['remote'], { cwd: repo, encoding: 'utf8' }).split('\n');
  if (!have.includes('origin')) execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: repo });
  return bare;
}
