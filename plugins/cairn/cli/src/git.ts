import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { CliError } from './util.ts';

/**
 * Git forks `maintenance run --auto --detach` after commit, merge and similar commands. That
 * background process can repack or prune while the CLI's next git command runs in the same
 * repo, so every CLI git call turns auto maintenance off. The user's own git commands are unaffected.
 */
const NO_AUTO_MAINTENANCE = ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false'];

export function git(args: string[], cwd: string): string {
  const r = spawnSync('git', [...NO_AUTO_MAINTENANCE, ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new CliError(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

export function gitOk(args: string[], cwd: string): boolean {
  return spawnSync('git', [...NO_AUTO_MAINTENANCE, ...args], { cwd, encoding: 'utf8' }).status === 0;
}

export interface Worktree {
  path: string;
  branch?: string;
}

export function worktrees(cwd: string): Worktree[] {
  const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' });
  const list: Worktree[] = [];
  for (const block of out.split('\n\n')) {
    const path = block.match(/^worktree (.+)$/m)?.[1];
    if (!path) continue;
    const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1];
    list.push({ path, branch });
  }
  return list;
}

export const currentBranch = (cwd: string): string => git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
export const topLevel = (cwd: string): string => git(['rev-parse', '--show-toplevel'], cwd);
export const commonDir = (cwd: string): string => git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);

export const branchExists = (name: string, cwd: string): boolean =>
  gitOk(['show-ref', '--verify', '--quiet', `refs/heads/${name}`], cwd);

/** Commit only the given path, if it has changes. */
export function commitPath(cwd: string, path: string, message: string): boolean {
  git(['add', '-A', '--', path], cwd);
  if (gitOk(['diff', '--cached', '--quiet', '--', path], cwd)) return false;
  git(['commit', '-q', '-m', message, '--', path], cwd);
  return true;
}

/**
 * Non-merge commits on `head`'s first-parent history since `base`, each with the files it changed. A task branch
 * merged with `--no-ff` hangs off the second parent, so only work committed directly on `head` (or merged by
 * fast-forward) shows up here.
 */
export function directCommits(cwd: string, base: string, head: string): { sha: string; files: string[] }[] {
  const shas = git(['rev-list', '--first-parent', '--no-merges', `${base}..${head}`], cwd).split('\n').filter(Boolean);
  return shas.map((sha) => ({
    sha: sha.slice(0, 7),
    files: git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--root', sha], cwd).split('\0').filter(Boolean),
  }));
}

export type MergeState = 'merged' | 'open' | 'unknown';

/** Nothing here may prompt for credentials. */
const quietEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' });

/** A branch or base name that is safe to hand to git: state.json is committed, so it is untrusted. */
export function safeRef(cwd: string, name: string): boolean {
  if (!name || name.startsWith('-') || name.includes('@{')) return false;
  return gitOk(['check-ref-format', '--branch', name], cwd);
}

/**
 * Whether `branch` has landed in `base`, judged locally with no network. Prefers `origin/<base>` when that ref
 * exists, else the local base. Commits that touch only the plan folder (the record, findings and PR link written
 * after the merge) do not count. Invalid or missing refs are `unknown`.
 */
export function mergeState(cwd: string, branch: string, base: string, planRel: string): MergeState {
  if (!safeRef(cwd, branch) || !safeRef(cwd, base) || !branchExists(branch, cwd)) return 'unknown';
  let ref: string;
  if (gitOk(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${base}`], cwd)) ref = `origin/${base}`;
  else if (branchExists(base, cwd)) ref = base;
  else return 'unknown';
  const args = ['rev-list', '-n', '1', '--end-of-options', `${ref}..${branch}`, '--', ':/', `:(exclude,top,literal)${planRel}`];
  const r = spawnSync('git', [...NO_AUTO_MAINTENANCE, ...args], { cwd, encoding: 'utf8', env: quietEnv() });
  if (r.status !== 0) return 'unknown';
  return r.stdout.trim() === '' ? 'merged' : 'open';
}

const PR_CACHE_TTL_MS = 60_000;
type PrCache = Record<string, { merged: boolean; at: number }>;

/**
 * Whether `gh` says the branch's pull request is merged (a squash or rebase merge shows only here). The answer is
 * cached so the pane's polling never waits on the network; a failed call counts as not merged.
 */
export function prMerged(cwd: string, branch: string, cacheFile: string): boolean {
  let cache: PrCache = {};
  try {
    cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
  } catch {
    // No cache yet.
  }
  const hit = cache[branch];
  if (hit && (hit.merged || Date.now() - hit.at < PR_CACHE_TTL_MS)) return hit.merged;
  if (!safeRef(cwd, branch)) return false;
  const r = spawnSync('gh', ['pr', 'view', branch, '--json', 'state', '-q', '.state'], { cwd, encoding: 'utf8', timeout: 5000, env: quietEnv() });
  const merged = r.status === 0 && r.stdout.trim() === 'MERGED';
  try {
    writeFileSync(cacheFile, JSON.stringify({ ...cache, [branch]: { merged, at: Date.now() } }));
  } catch {
    // An unwritable cache only costs another call.
  }
  return merged;
}

/** Merged by local ancestry, else by the pull request's state. Display only: nothing gates on it. */
export function landedState(cwd: string, branch: string, base: string, planRel: string, cacheFile: string): MergeState {
  const local = mergeState(cwd, branch, base, planRel);
  return local === 'open' && prMerged(cwd, branch, cacheFile) ? 'merged' : local;
}
