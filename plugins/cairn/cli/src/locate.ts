import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { branchExists, currentBranch, git, gitOk, topLevel, worktrees, type Worktree } from './git.ts';
import type { Track } from './types.ts';
import { DOCS_DIR, LEGACY_DOCS_DIR } from './paths.ts';
import { CliError } from './util.ts';

export const PLANS_DIR = `${DOCS_DIR}/plans`;
/** The pre-rename plans root: still read, never written. */
export const LEGACY_PLANS_DIR = `${LEGACY_DOCS_DIR}/plans`;
/** Every plans root, newest first. */
export const PLANS_DIRS: readonly string[] = [PLANS_DIR, LEGACY_PLANS_DIR];
/** The plans roots that exist under `root`, as absolute paths, new root first. */
export const plansDirsIn = (root: string): string[] => PLANS_DIRS.map((d) => join(root, d)).filter((d) => existsSync(d));
/** Prefixes a plan branch can carry. `sdlc/` is legacy: plans recorded on it keep their name. */
export const PLAN_PREFIXES = ['feature/', 'fix/', 'sdlc/'] as const;
/** Task branch prefixes. `sdlc-task/` is legacy. */
export const TASK_PREFIXES = ['task/', 'sdlc-task/'] as const;

export const planBranch = (slug: string, track: Track) => `${track === 'fix' ? 'fix/' : 'feature/'}${slug}`;
export const taskBranch = (slug: string, task: string) => `task/${slug}/${task}`;
/** Worktree folder for a branch: `/` becomes `-`. */
export const worktreeName = (branch: string) => branch.replace(/\//g, '-');
/** The legacy (undated) plan folder, relative to the repo root. */
export const planRel = (slug: string) => `${PLANS_DIR}/${slug}`;
/** Folder name for a new plan: the start date, then the slug. A Date gives its local calendar day; a string is an ISO timestamp. */
export function planDirName(slug: string, created: string | Date): string {
  if (typeof created === 'string') return `${created.slice(0, 10)}-${slug}`;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${created.getFullYear()}-${p(created.getMonth() + 1)}-${p(created.getDate())}-${slug}`;
}

const DATED = /^\d{4}-\d{2}-\d{2}-/;
/** Of the folder names found, the one holding this slug: exactly `<date>-<slug>` (newest first) or `<slug>`. */
function pickPlanDir(slug: string, names: string[], hasPlan: (name: string) => boolean): string | undefined {
  const dated = names.filter((n) => DATED.test(n) && n.slice(11) === slug).sort().reverse();
  return [...dated, slug].find((n) => names.includes(n) && hasPlan(n));
}

/**
 * The plan's folder relative to the repo root, under either name (`<date>-<slug>` or the old `<slug>`),
 * read from a checkout (`root`) or from a branch's committed tree (`ref`). Undefined when neither holds the plan.
 */
export function resolvePlanDir(slug: string, where: { root: string } | { ref: string; cwd: string }): string | undefined {
  for (const plans of PLANS_DIRS) {
    const name = 'root' in where ? pickInRoot(slug, join(where.root, plans)) : pickInRef(slug, plans, where.ref, where.cwd);
    if (name) return `${plans}/${name}`;
  }
  return undefined;
}
function pickInRoot(slug: string, base: string): string | undefined {
  if (!existsSync(base)) return undefined;
  return pickPlanDir(slug, readdirSync(base), (n) => existsSync(join(base, n, 'state.json')));
}
function pickInRef(slug: string, plans: string, ref: string, cwd: string): string | undefined {
  let names: string[];
  try {
    names = git(['ls-tree', '--name-only', ref, `${plans}/`], cwd)
      .split('\n')
      .filter(Boolean)
      .map((p) => p.slice(plans.length + 1));
  } catch {
    return undefined;
  }
  return pickPlanDir(slug, names, (n) => gitOk(['cat-file', '-e', `${ref}:${plans}/${n}/state.json`], cwd));
}
/** Plan folder in a checkout, falling back to the old undated name when nothing is there yet. */
export const planRelIn = (slug: string, root: string) => resolvePlanDir(slug, { root }) ?? planRel(slug);
/** The plan's folder relative to its worktree. */
export const planRelOf = (plan: { worktree: string; dir: string }) => relative(plan.worktree, plan.dir);

/** The branch a ref's committed plan state records for the plan, if it holds one. */
export function recordedBranch(ref: string, slug: string, cwd: string): string | undefined {
  try {
    const rel = resolvePlanDir(slug, { ref, cwd });
    return rel ? JSON.parse(git(['show', `${ref}:${rel}/state.json`], cwd)).branch : undefined;
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
  return wt ? { slug, worktree: wt.path, dir: join(wt.path, planRelIn(slug, wt.path)) } : { slug };
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
        recorded = JSON.parse(readFileSync(join(top, planRelIn(s, top), 'state.json'), 'utf8')).branch;
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
