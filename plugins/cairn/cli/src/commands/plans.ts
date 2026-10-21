import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig, worktreeRoot } from '../config.ts';
import { commitPath, git, gitOk } from '../git.ts';
import { planBranch, planBranchesFor, planRel, worktreeName, type Ctx } from '../locate.ts';
import { newState, saveState } from '../state.ts';
import { CliError, now, readText, Refusal, SLUG, writeText } from '../util.ts';
import { ensureExcluded, planCtx, planFile, runSetup, template, type Opts, type PlanCtx, type Result } from '../shared.ts';

export function cmdNew(ctx: Ctx, slug: string | undefined, opts: Opts): Result {
  if (!slug || !SLUG.test(slug)) throw new CliError('usage: cairn new <kebab-case-slug> --title "…"');
  const track = opts.track === 'fix' ? 'fix' : 'feature';
  const branch = planBranch(slug, track);
  const existing = planBranchesFor(slug, ctx.top)[0];
  if (existing) throw new Refusal(`a plan named "${slug}" already exists (${existing})`, [`cairn resume ${slug}`, 'or pick another slug']);
  if (!gitOk(['rev-parse', '--verify', 'HEAD'], ctx.top)) throw new Refusal('the repository has no commits yet', ['make an initial commit first']);
  const mainBranch = ctx.worktrees[0]?.branch ?? ctx.branch;
  const base = typeof opts.from === 'string' ? opts.from : ctx.plan ? mainBranch : ctx.branch;
  const title = typeof opts.title === 'string' ? opts.title : slug;
  const cfg = loadConfig(ctx.top, ctx.mainRoot);

  let wt: string;
  if (opts['no-worktree']) {
    git(['switch', '-q', '-c', branch, base], ctx.top);
    wt = ctx.top;
  } else {
    const root = worktreeRoot(cfg, ctx.mainRoot);
    if (!cfg.worktreeRoot) ensureExcluded(ctx.mainRoot, '.claude/worktrees/');
    wt = join(root, worktreeName(branch));
    git(['worktree', 'add', '-q', '-b', branch, wt, base], ctx.top);
  }
  const dir = join(wt, planRel(slug));
  writeText(join(dir, 'decisions.md'), `# Decisions: ${title}\n\nAppend-only. Written by \`cairn decide\` as each decision is made.\n`);
  const state = newState(slug, title, track, branch, base);
  if (track === 'fix') state.stage = 'repro';
  saveState(dir, state);
  if (cfg.autoCommit) commitPath(wt, planRel(slug), `cairn(${slug}): start plan "${title}"`);
  const setup = opts['no-worktree'] ? '' : runSetup(cfg, wt, ctx.mainRoot);
  return {
    message: [
      `Started plan "${title}" on ${branch} (from ${base}).${setup}`,
      `Worktree: ${wt}`,
      `The plan is ready. Continue with /cairn:next from where you are.`,
    ].join('\n'),
    data: { slug, branch, base, worktree: wt, dir },
  };
}

export function cmdProductInit(ctx: Ctx): Result {
  const dir = join(ctx.top, 'docs/sdlc/product');
  const prd = join(dir, 'PRD.md');
  if (existsSync(prd)) throw new Refusal('docs/sdlc/product/PRD.md already exists', ['edit it with the product procedure instead']);
  writeText(prd, template('product-prd.md') ?? '# Product PRD\n\n## Vision\n\n## Users\n\n## Non-goals\n\n## Non-functional requirements\n\n## Must not trade off\n\n## Roadmap\n');
  writeText(join(dir, 'decisions', '.gitkeep'), '');
  return { message: `Created docs/sdlc/product/PRD.md and decisions/ on ${ctx.branch}. Fill it in, then commit.`, data: { path: prd } };
}

export function cmdDecide(ctx: Ctx, question: string | undefined, answer: string | undefined, opts: Opts): Result {
  const d = typeof opts.file === 'string' ? readDecisionFile(ctx.cwd, opts.file) : { question, answer, why: typeof opts.why === 'string' ? opts.why : undefined };
  if (!d.question || !d.answer) throw new CliError('usage: cairn decide "<question>" "<answer>" [--why "…"] | cairn decide --file <path>');
  const n = appendDecision(planCtx(ctx), d.question, d.answer, d.why);
  return { message: `Recorded decision ${n}: ${d.answer}`, data: { number: n } };
}

/** Read `{question, answer, why?}` from a JSON file; relative paths resolve from `cwd`. */
function readDecisionFile(cwd: string, file: string): { question: string; answer: string; why?: string } {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(resolve(cwd, file), 'utf8'));
  } catch (e) {
    throw new CliError(`cannot read decision file ${file}: ${(e as Error).message}`);
  }
  const obj = data as Record<string, unknown> | null;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || typeof obj.question !== 'string' || typeof obj.answer !== 'string' || (obj.why !== undefined && typeof obj.why !== 'string'))
    throw new CliError(`decision file ${file} must be a JSON object {"question": "…", "answer": "…", "why": "…"} (why optional)`);
  return { question: obj.question, answer: obj.answer, why: obj.why as string | undefined };
}

/** Append a numbered decision to decisions.md; returns its number. */
export function appendDecision(pc: PlanCtx, question: string, answer: string, why?: string): number {
  const file = planFile(pc, 'decisions.md');
  const cur = readText(file) ?? '# Decisions\n';
  const n = (cur.match(/^### /gm)?.length ?? 0) + 1;
  writeText(file, `${cur.replace(/\n*$/, '\n')}\n### ${n}. ${question}\n**Decision:** ${answer}${why ? `\n**Why:** ${why}` : ''}\n_${now().slice(0, 16).replace('T', ' ')}_\n`);
  return n;
}
