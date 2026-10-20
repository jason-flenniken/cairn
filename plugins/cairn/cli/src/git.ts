import { execFileSync, spawnSync } from 'node:child_process';
import { CliError } from './util.ts';

export function git(args: string[], cwd: string): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new CliError(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

export function gitOk(args: string[], cwd: string): boolean {
  return spawnSync('git', args, { cwd, encoding: 'utf8' }).status === 0;
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
