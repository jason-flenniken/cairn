import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CONFIG_REL, loadConfig, worktreeRoot } from '../config.ts';
import { commitPath, git, gitOk } from '../git.ts';
import { DOCS_DIR } from '../paths.ts';
import { PLANS_DIR, planBranch, planBranchesFor, planDirName, worktreeName, type Ctx } from '../locate.ts';
import { loadAreas } from '../areas.ts';
import { loadDecisions, publishDecisions } from '../decision-log.ts';
import { loadState, log, newState, saveState } from '../state.ts';
import { isLevel, LEVELS, type Level, type PendingDecision } from '../types.ts';
import { CliError, now, pluginVersion, readText, Refusal, SLUG, writeText } from '../util.ts';
import { ensureExcluded, mutate, planCtx, planFile, runSetup, template, type Opts, type PlanCtx, type Result } from '../shared.ts';

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
  if (typeof opts.level === 'string' && !isLevel(opts.level)) throw new Refusal(`"${opts.level}" is not a level: use ${LEVELS.join(', ')}`);
  const badDefault = cfg.defaultLevel !== undefined && !isLevel(cfg.defaultLevel);
  const level: Level = typeof opts.level === 'string' ? (opts.level as Level) : isLevel(cfg.defaultLevel) ? cfg.defaultLevel : 'standard';

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
  const rel = `${PLANS_DIR}/${planDirName(slug, new Date())}`;
  const dir = join(wt, rel);
  writeText(join(dir, 'decisions.md'), `# Decisions: ${title}\n\nAppend-only. Written by \`cairn decide\` as each decision is made.\n`);
  const state = newState(slug, title, track, branch, base, track === 'fix' ? 'repro' : 'discover');
  state.cairnVersion = pluginVersion();
  if (track === 'feature') {
    state.level = level;
    log(state, 'level', level);
  }
  saveState(dir, state);
  if (cfg.autoCommit) commitPath(wt, rel, `cairn(${slug}): start plan "${title}"`);
  const setup = opts['no-worktree'] ? '' : runSetup(cfg, wt, ctx.mainRoot);
  return {
    message: [
      `Started plan "${title}" on ${branch} (from ${base}).${setup}`,
      ...(badDefault ? [`Warning: defaultLevel "${cfg.defaultLevel}" in ${CONFIG_REL} is not one of ${LEVELS.join(', ')}; using standard.`] : []),
      `Worktree: ${wt}`,
      `The plan is ready. Continue with /cairn:next from where you are.`,
    ].join('\n'),
    data: { slug, branch, base, worktree: wt, dir, level: track === 'feature' ? level : null },
  };
}

export function cmdProductInit(ctx: Ctx): Result {
  const dir = join(ctx.top, `${DOCS_DIR}/product`);
  const prd = join(dir, 'PRD.md');
  if (existsSync(prd)) throw new Refusal(`${DOCS_DIR}/product/PRD.md already exists`, ['edit it with the product procedure instead']);
  writeText(prd, template('product-prd.md') ?? '# Product PRD\n\n## Vision\n\n## Users\n\n## Non-goals\n\n## Non-functional requirements\n\n## Must not trade off\n\n## Roadmap\n');
  writeText(join(dir, 'decisions', '.gitkeep'), '');
  return { message: `Created ${DOCS_DIR}/product/PRD.md and decisions/ on ${ctx.branch}. Fill it in, then commit.`, data: { path: prd } };
}

/** What makes a decision lasting: the areas and paths that recall finds it by, and the logged decision it replaces. */
interface Lasting {
  areas: string[];
  paths: string[];
  replaces?: string;
}

const csv = (v: unknown): string[] => (typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);
/** The local calendar day, as plan folders use. */
const today = () => planDirName('', new Date()).slice(0, 10);

/** Check the scope of a lasting decision against the area docs and the log under `root`. */
function checkLasting(root: string, l: Lasting): void {
  if (!l.areas.length && !l.paths.length) throw new Refusal('a lasting decision needs --areas or --paths, so recall can find it', ['add --areas <area-id>[,…] or --paths "<glob>[,…]"']);
  const { areas } = loadAreas(root);
  const bad = areas.length ? l.areas.filter((a) => !areas.some((x) => x.id === a)) : [];
  if (bad.length) throw new Refusal(`unknown area ${bad.join(', ')}`, [`use one of: ${areas.map((x) => x.id).join(', ')}`]);
  if (l.replaces && !loadDecisions(root).some((d) => d.id === l.replaces))
    throw new Refusal(`no logged decision "${l.replaces}" to replace`, ['cairn recall lists logged decisions with their ids']);
}

export function cmdDecide(ctx: Ctx, question: string | undefined, answer: string | undefined, opts: Opts): Result {
  const f: Partial<ReturnType<typeof readDecisionFile>> = typeof opts.file === 'string' ? readDecisionFile(ctx.cwd, opts.file) : {};
  const d = typeof opts.file === 'string' ? f : { question, answer, why: typeof opts.why === 'string' ? opts.why : undefined };
  const lasting: Lasting = {
    areas: [...csv(opts.areas), ...(f.areas ?? [])],
    paths: [...csv(opts.paths), ...(f.paths ?? [])],
    replaces: typeof opts.replaces === 'string' ? opts.replaces : f.replaces,
  };
  const promote = opts.promote !== undefined;
  const isLasting = opts.lasting === true || f.lasting === true;
  if (promote) {
    const n = Number(opts.promote);
    if (!Number.isInteger(n) || n < 1) throw new CliError('usage: cairn decide --promote <n> --areas a,b [--paths g1,g2] [--replaces <id>]');
    return promoteDecision(planCtx(ctx), n, lasting);
  }
  if (!d.question || !d.answer) throw new CliError('usage: cairn decide "<question>" "<answer>" [--why "…"] [--lasting --areas a,b] | cairn decide --file <path> | cairn decide --promote <n> --areas a,b');
  if (!ctx.plan) {
    // Off a plan only a backfill makes sense: publish straight to the log.
    if (!isLasting) planCtx(ctx);
    checkLasting(ctx.top, lasting);
    const p: PendingDecision = { n: 0, question: d.question, answer: d.answer, why: d.why, ...lasting, at: now() };
    const files = publishDecisions(ctx.top, typeof opts.plan === 'string' ? opts.plan : 'map', typeof opts.date === 'string' ? opts.date : today(), [p]);
    return { message: files.length ? `Logged decision: ${d.answer}` : `Already logged: ${d.question}`, data: { files } };
  }
  const pc = planCtx(ctx);
  if (isLasting) checkLasting(pc.plan.worktree, lasting);
  const n = appendDecision(pc, d.question, d.answer, d.why, isLasting ? lasting : undefined);
  if (isLasting) mutate(pc, undefined, (s) => void (s.lasting ??= []).push({ n, question: d.question!, answer: d.answer!, why: d.why, ...lasting, at: now() }));
  return { message: `Recorded decision ${n}${isLasting ? ' as lasting' : ''}: ${d.answer}`, data: { number: n } };
}

/** Flag an existing numbered decision as lasting without adding a new one. */
function promoteDecision(pc: PlanCtx, n: number, lasting: Lasting): Result {
  checkLasting(pc.plan.worktree, lasting);
  const file = planFile(pc, 'decisions.md');
  const cur = readText(file) ?? '';
  const found = parseDecisions(cur).find((x) => x.n === n);
  if (!found) throw new Refusal(`no decision ${n} in decisions.md`, ['cairn decide "<question>" "<answer>" --lasting records a new one']);
  if (loadState(pc.plan.dir).lasting?.some((x) => x.n === n)) throw new Refusal(`decision ${n} is already lasting`);
  writeText(file, withLastingLine(cur, n, lasting));
  mutate(pc, undefined, (s) => void (s.lasting ??= []).push({ ...found, ...lasting, at: now() }));
  return { message: `Flagged decision ${n} as lasting: ${found.answer}`, data: { number: n } };
}

/** Read the numbered decisions that `appendDecision` writes. */
export function parseDecisions(md: string): { n: number; question: string; answer: string; why?: string }[] {
  const out: { n: number; question: string; answer: string; why?: string }[] = [];
  for (const block of md.split(/^(?=### \d+\. )/m)) {
    const h = /^### (\d+)\. (.*)\n/.exec(block);
    if (!h) continue;
    const rest = block.slice(h[0].length);
    const a = /^\*\*Decision:\*\* ([\s\S]*?)(?=\n\*\*Why:\*\* |\n\*\*Lasting:\*\* |\n_[^\n]*_\s*$|\s*$)/.exec(rest);
    if (!a) continue;
    const w = /\n\*\*Why:\*\* ([\s\S]*?)(?=\n\*\*Lasting:\*\* |\n_[^\n]*_\s*$|\s*$)/.exec(rest);
    out.push({ n: Number(h[1]), question: h[2], answer: a[1], ...(w ? { why: w[1] } : {}) });
  }
  return out;
}

const lastingLine = (l: Lasting) => `**Lasting:** ${[l.areas.length ? `areas: ${l.areas.join(', ')}` : '', l.paths.length ? `paths: ${l.paths.join(', ')}` : '', l.replaces ? `replaces: ${l.replaces}` : ''].filter(Boolean).join('; ')}`;

/** Put the lasting line at the end of decision `n`'s block, above its timestamp. */
function withLastingLine(md: string, n: number, l: Lasting): string {
  return md
    .split(/^(?=### \d+\. )/m)
    .map((block) => {
      if (!block.startsWith(`### ${n}. `)) return block;
      const lines = block.replace(/\n*$/, '').split('\n');
      const at = /^_.*_$/.test(lines[lines.length - 1]) ? lines.length - 1 : lines.length;
      lines.splice(at, 0, lastingLine(l));
      return `${lines.join('\n')}\n`;
    })
    .join('');
}

/** Read `{question, answer, why?}` from a JSON file, plus the optional lasting fields; relative paths resolve from `cwd`. */
function readDecisionFile(cwd: string, file: string): { question: string; answer: string; why?: string; lasting?: boolean; areas?: string[]; paths?: string[]; replaces?: string } {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(resolve(cwd, file), 'utf8'));
  } catch (e) {
    throw new CliError(`cannot read decision file ${file}: ${(e as Error).message}`);
  }
  const obj = data as Record<string, unknown> | null;
  const list = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || typeof obj.question !== 'string' || typeof obj.answer !== 'string' || (obj.why !== undefined && typeof obj.why !== 'string') || !list(obj.areas) || !list(obj.paths) || (obj.replaces !== undefined && typeof obj.replaces !== 'string') || (obj.lasting !== undefined && typeof obj.lasting !== 'boolean'))
    throw new CliError(`decision file ${file} must be a JSON object {"question": "…", "answer": "…", "why": "…"} (why optional; lasting, areas, paths, replaces optional)`);
  return { question: obj.question, answer: obj.answer, why: obj.why as string | undefined, lasting: obj.lasting as boolean | undefined, areas: obj.areas as string[] | undefined, paths: obj.paths as string[] | undefined, replaces: obj.replaces as string | undefined };
}

/** Append a numbered decision to decisions.md; returns its number. */
export function appendDecision(pc: PlanCtx, question: string, answer: string, why?: string, lasting?: Lasting): number {
  const file = planFile(pc, 'decisions.md');
  const cur = readText(file) ?? '# Decisions\n';
  const n = (cur.match(/^### /gm)?.length ?? 0) + 1;
  writeText(file, `${cur.replace(/\n*$/, '\n')}\n### ${n}. ${question}\n**Decision:** ${answer}${why ? `\n**Why:** ${why}` : ''}${lasting ? `\n${lastingLine(lasting)}` : ''}\n_${now().slice(0, 16).replace('T', ' ')}_\n`);
  return n;
}
