import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { configWarning } from '../config.ts';
import { commonDir, git, landedState } from '../git.ts';
import { PLAN_PREFIXES, parseBranch, planRef, planRelIn, planRelOf, resolvePlanDir, type Ctx } from '../locate.ts';
import { DOCS_DIR } from '../paths.ts';
import { modActive } from '../proof.ts';
import { levelLabel, nextFor, renderIndex, stepText, summary, timingText, type IndexRow } from '../render.ts';
import { levelOf, loadState, parseState, saveState, stageTimes } from '../state.ts';
import type { State } from '../types.ts';
import { hashText, pluginRoot, readText, withLock, writeText } from '../util.ts';
import { prdEditedSinceApproval, readyFor } from './stages.ts';
import { collectSuggestions, openSuggestionCount, type ListedSuggestion } from './suggest.ts';
import { knownFailures, planCtx, planFile, type Opts, type PlanCtx, type Result } from '../shared.ts';

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
  if (prdEditedSinceApproval(s, prd)) w.push(s.stage === 'plan' ? 'prd.md changed after it was approved: approving the plan accepts the edits' : 'prd.md changed after it was approved');
  const plan = readText(planFile(pc, 'plan.md'));
  if (s.planHash && plan && hashText(plan) !== s.planHash) w.push('plan.md changed after it was loaded: run `cairn plan load --replan` or revert it');
  const open = s.drift.filter((d) => !d.acked);
  if (open.length) w.push(`${open.length} file(s) changed outside the plan's scope`);
  const cw = configWarning(pc.plan.worktree);
  if (cw) w.push(cw);
  return w;
}

/**
 * A plan at learn or closed whose branch has not landed in its base yet is waiting on its pull request.
 * Display only: close never waits on it. Asks `gh` (cached) when local history cannot tell, so only `cairn status` calls this.
 */
function waitingOnMerge(ctx: Ctx, s: State, cwd: string, planRel: string): boolean {
  if (s.stage !== 'learn' && s.stage !== 'closed') return false;
  return landedState(cwd, s.branch, s.base, planRel, join(commonDir(ctx.mainRoot), 'cairn-pr-state.json')) === 'open';
}

export function cmdStatus(ctx: Ctx, opts: Opts): Result {
  if (opts.all || !ctx.plan) {
    const rows = listPlans(ctx);
    const active = rows.filter((r) => r.state.stage !== 'closed');
    const shown = rows.map((r) => ({ ...r, prOpen: waitingOnMerge(ctx, r.state, r.worktree ?? ctx.top, relative(r.worktree ?? ctx.mainRoot, r.dir)) }));
    const lines = rows.length
      ? shown.map((r) => `${r.state.stage === 'closed' ? '✓' : r.state.paused ? '⏸' : '•'} ${summary(r.state, r.prOpen)}\n    next: ${nextFor(r.state).text}${r.worktree ? '' : ' (not checked out)'}`)
      : ['No plans yet. Start one with /cairn:new.'];
    const openSuggestions = openSuggestionCount(ctx);
    return { message: `${active.length} active plan(s).\n${lines.join('\n')}`, data: { plans: shown.map((r) => ({ ...r, next: nextFor(r.state), stepText: stepText(r.state), level: levelOf(r.state), levelLabel: levelLabel(r.state), timing: stageTimes(r.state), openSuggestions, ready: r.worktree ? readyFor({ plan: { dir: r.dir } }) : undefined })), modActive: modIsActive(ctx), openSuggestions } };
  }
  const pc = planCtx(ctx);
  const s = loadState(pc.plan.dir);
  const w = warnings(pc, s);
  const next = nextFor(s);
  const prOpen = waitingOnMerge(ctx, s, pc.plan.worktree, planRelOf(pc.plan));
  let listed: ListedSuggestion[] = [];
  try {
    listed = collectSuggestions(ctx);
  } catch {
    // An unreadable follow-up listing leaves the counts and the grouping empty.
  }
  const openSuggestions = listed.filter((x) => x.open && !x.hardening).length;
  const hardeningItems = listed.filter((x) => x.open && x.hardening).length;
  // This plan's open hardening items by area; `hardeningItems` above spans every plan.
  const hardeningByArea: Record<string, number> = {};
  for (const x of listed) if (x.slug === s.slug && x.open && x.hardening) hardeningByArea[x.area] = (hardeningByArea[x.area] ?? 0) + 1;
  const timing = stageTimes(s);
  return {
    message: [summary(s, prOpen), `Next: ${prOpen ? 'merge the pull request; the plan shows "PR open" until it is merged.' : next.text}`,
      ...(s.level ? [`Level: ${levelLabel(s)}`] : []),
      ...(hardeningItems ? [`Hardening items: ${hardeningItems}`] : []),
      ...(s.stageHistory ? [`Time per stage: ${timingText(timing)}`] : []), ...w.map((x) => `! ${x}`), ...(ctx.task ? [`(You are in the worktree for task "${ctx.task}".)`] : [])].join('\n'),
    data: { state: s, next, level: levelOf(s), levelLabel: levelLabel(s), timing, prOpen, ready: readyFor(pc), warnings: w, task: ctx.task ?? null, planWorktree: pc.plan.worktree, planDir: pc.plan.dir, modActive: modIsActive(ctx), openSuggestions, hardeningItems, hardeningByArea, knownFailures: knownFailures(s).map((x) => ({ key: `${s.slug}:${x.id}`, command: x.testCmd, text: x.text })) },
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
    data: { plan: s.slug, stage: s.stage, level: levelOf(s), levelLabel: levelLabel(s), substep: n.substep ?? null, procedure: procedurePath(n.procedure), summary: summary(s), text: n.text, warnings: warnings(pc, s), planWorktree: pc.plan.worktree, modActive: modIsActive(ctx) },
  };
}

export function cmdRender(ctx: Ctx): Result {
  if (ctx.plan) {
    const pc = planCtx(ctx);
    withLock(pc.plan.dir, () => saveState(pc.plan.dir, loadState(pc.plan.dir)));
    return { message: `Rendered ${join(pc.plan.dir, 'STATUS.md')}.` };
  }
  const out = join(ctx.top, `${DOCS_DIR}/INDEX.md`);
  writeText(out, renderIndex(listPlans(ctx)));
  return { message: `Rendered ${out}.` };
}
