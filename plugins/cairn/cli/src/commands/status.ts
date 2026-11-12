import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { configWarning, loadConfig } from '../config.ts';
import { commonDir, git, landedState } from '../git.ts';
import { PLAN_PREFIXES, parseBranch, planRef, planRelIn, planRelOf, resolvePlanDir, type Ctx } from '../locate.ts';
import { OVERVIEW_REL } from '../memory.ts';
import { modActive } from '../proof.ts';
import { levelLabel, nextFor, stepText, summary, timingText, type IndexRow } from '../render.ts';
import { levelOf, loadState, parseState, saveState, stageTimes } from '../state.ts';
import type { State } from '../types.ts';
import { hashText, pluginRoot, readText, withLock } from '../util.ts';
import { refreshMemory } from './memory.ts';
import { prdEditedSinceApproval, readyFor } from './stages.ts';
import { collectSuggestions, openSuggestionCount, type ListedSuggestion } from './suggest.ts';
import { isFoundational, linearConfig, takenIssues } from '../linear.ts';
import { allTasks } from '../ready.ts';
import { mergedAwaitingDone, mergedPlansAwaitingDone, pendingCount, queueDone } from './linear.ts';
import { knownFailures, mutate, planCtx, planFile, type Opts, type PlanCtx, type Result } from '../shared.ts';

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
  try {
    linearConfig(pc.cfg);
  } catch (e) {
    w.push((e as Error).message);
  }
  const changes = s.linear?.changes?.filter((c) => !c.handled).length ?? 0;
  if (changes) w.push(`Linear: ${changes} change${changes === 1 ? '' : 's'} to decide before the phase can finish (cairn linear status)`);
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

/**
 * Each task's name mapped to the keys of the plan's issues (not released) whose requirements it covers, in the order the plan
 * pulled them in. Undefined when the plan pulled in no Linear issues.
 */
export function taskIssuesOf(s: State): Record<string, string[]> | undefined {
  const l = s.linear;
  if (!l || !l.issues.length) return undefined;
  const taken = takenIssues(l);
  return Object.fromEntries(allTasks(s).map((t) => [t.name, taken.filter((i) => i.requirements?.some((r) => t.covers.includes(r))).map((i) => i.key)]));
}

/** The Linear fields a plan row carries: its task-to-issue keys and its epic. A plan without Linear issues carries neither. */
function linearRowFields(s: State): { taskIssues?: Record<string, string[]>; epic?: string } {
  const taskIssues = taskIssuesOf(s);
  if (!taskIssues) return {};
  return { taskIssues, ...(s.linear?.epic ? { epic: s.linear.epic } : {}) };
}

/** Status never fails over a Linear setting: a bad value shows as a warning (the Linear commands refuse with the fix). */
function foundationalSafe(s: State, pc: PlanCtx): boolean {
  try {
    return isFoundational(s.linear, linearConfig(pc.cfg));
  } catch {
    return false;
  }
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
    return { message: `${active.length} active plan(s).\n${lines.join('\n')}`, data: { plans: shown.map((r) => ({ ...r, next: nextFor(r.state), stepText: stepText(r.state), level: levelOf(r.state), levelLabel: levelLabel(r.state), timing: stageTimes(r.state), ...linearRowFields(r.state), openSuggestions, ready: r.worktree ? readyFor({ plan: { dir: r.dir }, cfg: loadConfig(r.worktree, ctx.mainRoot) }) : undefined })), modActive: modIsActive(ctx), openSuggestions } };
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
    data: { state: s, next, ...(s.linear ? { foundational: foundationalSafe(s, pc) } : {}), level: levelOf(s), levelLabel: levelLabel(s), timing, prOpen, ready: readyFor(pc), warnings: w, task: ctx.task ?? null, planWorktree: pc.plan.worktree, planDir: pc.plan.dir, modActive: modIsActive(ctx), openSuggestions, hardeningItems, hardeningByArea, knownFailures: knownFailures(s).map((x) => ({ key: `${s.slug}:${x.id}`, command: x.testCmd, text: x.text })) },
  };
}

export const procedurePath = (name: string) => join(pluginRoot(), 'procedures', `${name}.md`);

export function cmdNext(ctx: Ctx): Result {
  if (!ctx.plan) {
    // A plan merged since anyone ran cairn in it still owes Linear its Done statuses: send them first, from its worktree.
    const owed = mergedPlansAwaitingDone(ctx)[0];
    if (owed)
      return {
        message: `Plan ${owed.slug} has merged and its Linear issues are not marked Done yet. Follow linear-sync from its worktree: ${owed.worktree}\nFollow: ${procedurePath('linear-sync')}`,
        data: { plan: owed.slug, stage: null, procedure: procedurePath('linear-sync'), planWorktree: owed.worktree, summary: `${owed.slug} merged; Linear updates due.`, modActive: modIsActive(ctx) },
      };
    const active = listPlans(ctx).filter((r) => r.state.stage !== 'closed');
    if (!active.length) return { message: 'No active plans. Start one.', data: { plan: null, stage: null, procedure: procedurePath('new'), summary: 'No active plans.', modActive: modIsActive(ctx) } };
    return {
      message: `Active plans:\n${active.map((r) => `  ${summary(r.state)}`).join('\n')}\nAsk the user which plan to resume (/cairn:resume <slug>) or whether to start a new one (/cairn:new).`,
      data: { plan: null, stage: null, procedure: procedurePath('status'), plans: active.map((r) => r.state.slug), modActive: modIsActive(ctx) },
    };
  }
  const pc = planCtx(ctx);
  let s = loadState(pc.plan.dir);
  // A merged plan's Done statuses are queued here too, so a PR the user merged later still closes its issues.
  if (mergedAwaitingDone(pc, s)) s = mutate(pc, undefined, (x) => (queueDone(pc, x), x));
  // Queued Linear updates go out before the stage's own work, so none are forgotten.
  const queued = pendingCount(s);
  const stageNext = nextFor(s);
  const n = queued ? { procedure: 'linear-sync', text: `Send ${queued} queued Linear update${queued === 1 ? '' : 's'} first. Then: ${stageNext.text}` } : stageNext;
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
  refreshMemory(ctx.top, ctx);
  return { message: `Rendered ${join(ctx.top, OVERVIEW_REL)} (the changelog).` };
}
