import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { currentBranch, topLevel, worktrees, type Worktree } from './git.ts';
import { CliError } from './util.ts';

export const PLAN_PREFIX = 'sdlc/';
export const SLICE_PREFIX = 'sdlc-slice/';
export const PLANS_DIR = 'docs/sdlc/plans';

export const planBranch = (slug: string) => `${PLAN_PREFIX}${slug}`;
export const sliceBranch = (slug: string, slice: string) => `${SLICE_PREFIX}${slug}/${slice}`;
export const planRel = (slug: string) => `${PLANS_DIR}/${slug}`;

export interface PlanRef {
  slug: string;
  /** Worktree that has the plan branch checked out, if any. */
  worktree?: string;
  /** Absolute plan dir inside that worktree. */
  dir?: string;
}

export interface Ctx {
  cwd: string;
  top: string;
  /** The repository's main worktree (first in `git worktree list`). */
  mainRoot: string;
  branch: string;
  worktrees: Worktree[];
  plan?: PlanRef;
  slice?: string;
}

export function parseBranch(branch: string): { slug?: string; slice?: string } {
  if (branch.startsWith(PLAN_PREFIX)) return { slug: branch.slice(PLAN_PREFIX.length) };
  if (branch.startsWith(SLICE_PREFIX)) {
    const [slug, slice] = branch.slice(SLICE_PREFIX.length).split('/');
    return { slug, slice };
  }
  return {};
}

export function planRef(slug: string, wts: Worktree[]): PlanRef {
  const wt = wts.find((w) => w.branch === planBranch(slug));
  return wt ? { slug, worktree: wt.path, dir: join(wt.path, planRel(slug)) } : { slug };
}

export function context(cwd: string, slugOverride?: string): Ctx {
  let top: string;
  try {
    top = topLevel(cwd);
  } catch {
    throw new CliError('not inside a git repository');
  }
  const wts = worktrees(top);
  const branch = currentBranch(top);
  const { slug, slice } = parseBranch(branch);
  const ctx: Ctx = { cwd, top, mainRoot: wts[0]?.path ?? top, branch, worktrees: wts, slice };
  const s = slugOverride ?? slug;
  if (s) ctx.plan = planRef(s, wts);
  return ctx;
}

/** The plan this command acts on; refuses when the session isn't on a plan. */
export function requirePlan(ctx: Ctx): Required<PlanRef> {
  const p = ctx.plan;
  if (!p) throw new CliError(`not on a plan branch (current: ${ctx.branch}). Use \`cairn status --all\` to list plans, or \`cairn new <slug>\`.`);
  if (!p.worktree || !p.dir || !existsSync(join(p.dir, 'state.json')))
    throw new CliError(`plan "${p.slug}" has no checked-out worktree with state. Check out ${planBranch(p.slug)} first.`);
  return p as Required<PlanRef>;
}

export const repoName = (mainRoot: string) => basename(mainRoot);
export const parentDir = dirname;
