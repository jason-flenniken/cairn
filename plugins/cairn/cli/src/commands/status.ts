import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { commonDir, git, mergeState } from '../git.ts';
import { PLAN_PREFIXES, parseBranch, planRef, planRelIn, resolvePlanDir, type Ctx } from '../locate.ts';
import { modActive } from '../proof.ts';
import { nextFor, renderIndex, summary, type IndexRow } from '../render.ts';
import { loadState, parseState, saveState } from '../state.ts';
import type { State } from '../types.ts';
import { hashText, pluginRoot, readText, withLock, writeText } from '../util.ts';
import { readyFor } from './stages.ts';
import { openSuggestionCount } from './suggest.ts';
import { planCtx, planFile, type Opts, type PlanCtx, type Result } from '../shared.ts';

export function listPlans(ctx: Ctx): IndexRow[] {
  const refs = git(['for-each-ref', '--format=%(refname:short)', ...PLAN_PREFIXES.map((p) => `refs/heads/${p}`)], ctx.top).split('\n').filter(Boolean);
  const rows: IndexRow[] = [];
  for (const b of refs) {
    const slug = parseBranch(b).slug;
    if (!slug) continue;
    const ref = planRef(slug, ctx.worktrees, b);
    try {
      const rel = resolvePlanDir(slug, { ref: b, cwd: ctx.top });
      const raw = ref.dir && existsSync(join(ref.dir, 'state.json')) ? readFileSync(join(ref.dir, 'state.json'), 'utf8') : git(['show', `${b}:${rel}/state.json`], ctx.top);
      const state = parseState(raw);
      if (state.branch !== b) continue; // a hand-made branch sharing a plan's slug
      rows.push({ state, live: !!ref.dir, worktree: ref.worktree, dir: ref.dir ?? join(ctx.mainRoot, resolvePlanDir(slug, { root: ctx.mainRoot }) ?? rel ?? planRelIn(slug, ctx.mainRoot)) });
    } catch {
      // A branch without plan state is not a cairn plan.
    }
  }
  return rows;
}

/** Whether the cairn mod's heartbeat is fresh, so procedures can pick the menu or the terminal path. */
const modIsActive = (ctx: Ctx): boolean => modActive(commonDir(ctx.mainRoot));

export function warnings(pc: PlanCtx, s: State): string[] {
  const w: string[] = [];
  const prd = readText(planFile(pc, 'prd.md'));
  if (s.approvals.prd?.hash && prd && hashText(prd) !== s.approvals.prd.hash) w.push('prd.md changed after it was approved');
  const plan = readText(planFile(pc, 'plan.md'));
  if (s.planHash && plan && hashText(plan) !== s.planHash) w.push('plan.md changed after it was loaded: run `cairn plan load --replan` or revert it');
  const open = s.drift.filter((d) => !d.acked);
  if (open.length) w.push(`${open.length} file(s) changed outside the plan's scope`);
  return w;
}

export function cmdStatus(ctx: Ctx, opts: Opts): Result {
  if (opts.all || !ctx.plan) {
    const rows = listPlans(ctx);
    const active = rows.filter((r) => r.state.stage !== 'closed');
    const lines = rows.length
      ? rows.map((r) => `${r.state.stage === 'closed' ? '✓' : r.state.paused ? '⏸' : '•'} ${summary(r.state)}\n    next: ${nextFor(r.state).text}${r.worktree ? '' : ' (not checked out)'}`)
      : ['No plans yet. Start one with /cairn:new.'];
    const openSuggestions = openSuggestionCount(ctx);
    return { message: `${active.length} active plan(s).\n${lines.join('\n')}`, data: { plans: rows.map((r) => ({ ...r, next: nextFor(r.state), openSuggestions, ready: r.worktree ? readyFor({ plan: { dir: r.dir } }) : undefined })), modActive: modIsActive(ctx), openSuggestions } };
  }
  const pc = planCtx(ctx);
  const s = loadState(pc.plan.dir);
  const w = warnings(pc, s);
  const next = nextFor(s);
  // A plan at learn whose branch is not merged yet is waiting on its pull request.
  const prOpen = s.stage === 'learn' && mergeState(pc.plan.worktree, s.branch, s.base) === 'open';
  return {
    message: [`${summary(s)}${prOpen ? ' · PR open' : ''}`, `Next: ${next.text}`, ...w.map((x) => `! ${x}`), ...(ctx.task ? [`(You are in the worktree for task "${ctx.task}".)`] : [])].join('\n'),
    data: { state: s, next, prOpen, ready: readyFor(pc), warnings: w, task: ctx.task ?? null, planWorktree: pc.plan.worktree, modActive: modIsActive(ctx), openSuggestions: openSuggestionCount(ctx) },
  };
}

export const procedurePath = (name: string) => join(pluginRoot(), 'procedures', `${name}.md`);

export function cmdNext(ctx: Ctx): Result {
  if (!ctx.plan) {
    const active = listPlans(ctx).filter((r) => r.state.stage !== 'closed');
    if (!active.length) return { message: 'No active plans. Start one.', data: { plan: null, stage: null, procedure: procedurePath('new'), summary: 'No active plans.', modActive: modIsActive(ctx) } };
    return {
      message: `Active plans:\n${active.map((r) => `  ${summary(r.state)}`).join('\n')}\nAsk the user which plan to resume (/cairn:resume <slug>) or whether to start a new one (/cairn:new).`,
      data: { plan: null, stage: null, procedure: procedurePath('status'), plans: active.map((r) => r.state.slug), modActive: modIsActive(ctx) },
    };
  }
  const pc = planCtx(ctx);
  const s = loadState(pc.plan.dir);
  const n = nextFor(s);
  return {
    message: `${summary(s)}\nNext: ${n.text}\nFollow: ${procedurePath(n.procedure)}`,
    data: { plan: s.slug, stage: s.stage, substep: n.substep ?? null, procedure: procedurePath(n.procedure), summary: summary(s), text: n.text, warnings: warnings(pc, s), planWorktree: pc.plan.worktree, modActive: modIsActive(ctx) },
  };
}

export function cmdRender(ctx: Ctx): Result {
  if (ctx.plan) {
    const pc = planCtx(ctx);
    withLock(pc.plan.dir, () => saveState(pc.plan.dir, loadState(pc.plan.dir)));
    return { message: `Rendered ${join(pc.plan.dir, 'STATUS.md')}.` };
  }
  const out = join(ctx.top, 'docs/sdlc/INDEX.md');
  writeText(out, renderIndex(listPlans(ctx)));
  return { message: `Rendered ${out}.` };
}
