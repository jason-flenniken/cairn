import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { branchExists, currentBranch, git, topLevel, worktrees, type Worktree } from './git.ts';
import type { Track } from './types.ts';
import { CliError } from './util.ts';

export const PLANS_DIR = 'docs/sdlc/plans';
/** Prefixes a plan branch can carry. `sdlc/` is legacy: plans recorded on it keep their name. */
export const PLAN_PREFIXES = ['feature/', 'fix/', 'sdlc/'] as const;
/** Task branch prefixes. `sdlc-task/` is legacy. */
export const TASK_PREFIXES = ['task/', 'sdlc-task/'] as const;

export const planBranch = (slug: string, track: Track) => `${track === 'fix' ? 'fix/' : 'feature/'}${slug}`;
export const taskBranch = (slug: string, task: string) => `task/${slug}/${task}`;
/** Worktree folder for a branch: `/` becomes `-`. */
export const worktreeName = (branch: string) => branch.replace(/\//g, '-');
export const planRel = (slug: string) => `${PLANS_DIR}/${slug}`;
/** The branch a ref's committed plan state records for the plan, if it holds one. */
export function recordedBranch(ref: string, slug: string, cwd: string): string | undefined {
  try {
    return JSON.parse(git(['show', `${ref}:${planRel(slug)}/state.json`], cwd)).branch;
  } catch {
    return undefined;
  }
}
/** Existing plan branches for a slug, on any prefix: only refs whose committed state records that very ref. */
export const planBranchesFor = (slug: string, cwd: string): string[] =>
  PLAN_PREFIXES.map((p) => `${p}${slug}`).filter((b) => branchExists(b, cwd) && recordedBranch(b, slug, cwd) === b);

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
  task?: string;
}

export function parseBranch(branch: string): { slug?: string; task?: string } {
  for (const p of PLAN_PREFIXES) if (branch.startsWith(p)) return { slug: branch.slice(p.length) };
  for (const p of TASK_PREFIXES)
    if (branch.startsWith(p)) {
      const [slug, task] = branch.slice(p.length).split('/');
      return { slug, task };
    }
  return {};
}

/** The plan's worktree: the one with the plan's own branch checked out. */
export function planRef(slug: string, wts: Worktree[], planBranch?: string): PlanRef {
  const wt = planBranch ? wts.find((w) => w.branch === planBranch) : undefined;
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
  const { slug, task } = parseBranch(branch);
  const ctx: Ctx = { cwd, top, mainRoot: wts[0]?.path ?? top, branch, worktrees: wts, task };
  const s = slugOverride ?? slug;
  if (s) {
    // A hand-made feature/, fix/ or task/ branch that isn't a plan's recorded branch is not a plan: behave as on main.
    let planBr: string | undefined;
    let accept = false;
    if (slugOverride) {
      planBr = planBranchesFor(s, top)[0];
      accept = true;
    } else {
      let recorded: string | undefined;
      try {
        recorded = JSON.parse(readFileSync(join(top, planRel(s), 'state.json'), 'utf8')).branch;
      } catch {
        // no readable state here
      }
      const legacy = branch.startsWith('sdlc/') || branch.startsWith('sdlc-task/');
      if (task) {
        planBr = recorded ?? (legacy ? `sdlc/${s}` : undefined);
        accept = legacy || (!!recorded && branchExists(recorded, top));
      } else {
        planBr = branch;
        accept = legacy || recorded === branch;
      }
    }
    if (accept) ctx.plan = planRef(s, wts, planBr);
  }
  return ctx;
}

/** The plan this command acts on; refuses when the session isn't on a plan. */
export function requirePlan(ctx: Ctx): Required<PlanRef> {
  const p = ctx.plan;
  if (!p) throw new CliError(`not on a plan branch (current: ${ctx.branch}). Use \`cairn status --all\` to list plans, or \`cairn new <slug>\`.`);
  if (!p.worktree || !p.dir || !existsSync(join(p.dir, 'state.json')))
    throw new CliError(`plan "${p.slug}" has no checked-out worktree with state. Run \`cairn resume ${p.slug}\` to check out its plan branch.`);
  return p as Required<PlanRef>;
}

export const repoName = (mainRoot: string) => basename(mainRoot);
export const parentDir = dirname;
