import { join } from 'node:path';
import { areasForFile, loadAreas, SYSTEM_DIR } from '../areas.ts';
import { commitPaths, git, safeRef } from '../git.ts';
import { planRelOf, type Ctx } from '../locate.ts';
import { memoryIndex, OVERVIEW_REL, recall, renderChangelog } from '../memory.ts';
import { isCairnPath } from '../paths.ts';
import { loadState, log } from '../state.ts';
import type { State } from '../types.ts';
import { CliError, now, readText, Refusal, writeText } from '../util.ts';
import { mutate, planCtx, type Opts, type PlanCtx, type Result } from '../shared.ts';
import { planEntries } from './records.ts';

/** The skip id for changed files that no area doc covers. */
export const UNCOVERED = '(uncovered)';

export interface AreaCheck {
  problems: string[];
  fixes: string[];
  warning?: string;
  /** Ids of every area that covers a changed code file. */
  touched: string[];
}

const some = (xs: string[], n: number) => xs.slice(0, n).join(', ');

/** Whether every area doc that covers code this plan changed was updated or skipped. */
export function areaCheck(worktree: string, s: State): AreaCheck {
  const none: AreaCheck = { problems: [], fixes: [], touched: [] };
  let changed: string[];
  try {
    if (!safeRef(worktree, s.base)) throw new Error('unsafe base');
    const base = git(['merge-base', s.base, 'HEAD'], worktree);
    changed = git(['diff', '--name-only', base, 'HEAD'], worktree).split('\n').filter(Boolean);
  } catch {
    return { ...none, warning: `could not compare with ${s.base}; area docs were not checked` };
  }
  const { areas, problems } = loadAreas(worktree);
  if (!areas.length && !problems.length) return { ...none, warning: `no area docs under ${SYSTEM_DIR}; run /cairn:map to set them up` };
  const code = changed.filter((f) => !isCairnPath(f));
  const skipped = new Set((s.areaSkips ?? []).map((x) => x.area));
  const touched: string[] = [];
  const out: string[] = [...problems];
  let stale = false;
  for (const a of areas) {
    const files = code.filter((f) => areasForFile(f, [a]).length);
    if (!files.length) continue;
    touched.push(a.id);
    if (changed.includes(a.file) || skipped.has(a.id)) continue;
    stale = true;
    out.push(`${a.file} covers files this plan changed (${some(files, 5)}) but was not updated`);
  }
  const orphans = code.filter((f) => !areasForFile(f, areas).length);
  const orphan = orphans.length > 0 && !skipped.has(UNCOVERED);
  if (orphan) out.push(`changed files belong to no area: ${some(orphans, 10)}`);
  const fixes: string[] = [];
  if (stale) {
    fixes.push('update each named area doc (Rules, How it works, Gotchas) for what this plan changed, and commit it on the plan branch');
    fixes.push('or, when a doc needs no change: cairn area skip <area> --note "<why>"');
  }
  if (orphan) {
    fixes.push("for files no area covers: add them to an area doc's paths, or create one from templates/area.md");
    fixes.push('or: cairn area skip --uncovered --note "<why>"');
  }
  return { problems: out, fixes, touched };
}

/** `cairn area skip <id> --note "…"` or `--uncovered`: record that an area doc needs no change for this plan. */
export function cmdAreaSkip(ctx: Ctx, area: string | undefined, opts: Opts): Result {
  const id = opts.uncovered === true ? UNCOVERED : area;
  if (!id) throw new CliError('usage: cairn area skip <id> --note "<why>" | cairn area skip --uncovered --note "<why>"');
  const note = typeof opts.note === 'string' ? opts.note.trim() : '';
  if (!note) throw new Refusal('an area skip needs a note saying why', [`cairn area skip ${id === UNCOVERED ? '--uncovered' : id} --note "<why>"`]);
  const pc = planCtx(ctx);
  if (id !== UNCOVERED) {
    const { areas } = loadAreas(pc.plan.worktree);
    if (!areas.some((a) => a.id === id)) throw new Refusal(`no area "${id}"`, [areas.length ? `use one of: ${areas.map((a) => a.id).join(', ')}` : `there are no area docs under ${SYSTEM_DIR}`]);
  }
  mutate(pc, undefined, (s) => {
    (s.areaSkips ??= []).push({ area: id, note, at: now() });
    log(s, 'area skip', `${id}: ${note}`);
  });
  if (pc.cfg.autoCommit) commitPaths(pc.plan.worktree, [planRelOf(pc.plan)], `area skip: ${id}`);
  return { message: `Skipped the area doc check for ${id}: ${note}` };
}

/** Rewrite the OVERVIEW changelog from the checkout at `root`. Returns the repo-relative files that changed. */
export function refreshMemory(root: string, ctx: Ctx): string[] {
  const before = readText(join(root, OVERVIEW_REL));
  const after = renderChangelog(root, planEntries(ctx));
  if (before === after) return [];
  writeText(join(root, OVERVIEW_REL), after);
  return [OVERVIEW_REL];
}

/** At close: refresh the OVERVIEW changelog and commit it. Returns the files changed. */
export function writeMemory(pc: PlanCtx, s: State): string[] {
  const root = pc.plan.worktree;
  const changed = refreshMemory(root, pc.ctx);
  if (pc.cfg.autoCommit && changed.length) commitPaths(root, changed, `cairn(${s.slug}): update changelog`);
  return changed;
}

/** `writeMemory` for a plan that just closed; a failure becomes a warning on the close message, never a failed close. */
export function closeMemory(pc: PlanCtx, r: Result): Result {
  try {
    writeMemory(pc, loadState(pc.plan.dir));
    return r;
  } catch (e) {
    return { ...r, message: `${r.message}\nWarning: the changelog was not updated (${(e as Error).message.split('\n')[0]}); run cairn render on main.` };
  }
}

/** `cairn recall <path or glob>...`: the area docs, decisions in force, and past plans that cover these paths. */
export function cmdRecall(ctx: Ctx, globs: string[], _opts: Opts): Result {
  if (!globs.length) throw new CliError('usage: cairn recall <path or glob>...');
  const r = recall(ctx.top, globs, planEntries(ctx));
  const { problems } = loadAreas(ctx.top);
  const out: string[] = [];
  if (r.areas.length) out.push('Areas:', ...r.areas.map((a) => `  ${a.id}: ${a.summary} (${a.file})`));
  if (r.decisions.length) out.push('Decisions in force:', ...r.decisions.map((d) => `  ${d.id}: ${d.answer} (${d.file})`));
  if (r.plans.length) out.push('Past plans:', ...r.plans.map((p) => `  ${p.date} ${p.title}${p.record ? `: ${p.record}` : ''}`));
  if (r.uncovered.length) out.push(`Not covered by any area: ${r.uncovered.join(', ')}`);
  if (problems.length) out.push(`Area docs with problems: ${problems.join('; ')}`);
  return { message: out.length ? out.join('\n') : 'Nothing recorded for these paths yet.', data: { ...r, problems } };
}

/** `cairn index`: the recent changelog entries that session start injects. Prints nothing when no plan is closed. */
export function cmdIndex(ctx: Ctx): Result {
  return { message: memoryIndex(ctx.top, () => planEntries(ctx)) };
}
