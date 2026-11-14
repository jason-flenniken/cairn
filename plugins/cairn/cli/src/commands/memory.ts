import { join } from 'node:path';
import { commonDir, commitPaths } from '../git.ts';
import type { Ctx } from '../locate.ts';
import { memoryIndex, OVERVIEW_REL, renderChangelog } from '../memory.ts';
import { loadState } from '../state.ts';
import type { State } from '../types.ts';
import { readText, Refusal, writeText } from '../util.ts';
import { archiveLedger, planUsage, renderUsage, USAGE_REL } from '../usage.ts';
import { planRelOf } from '../locate.ts';
import type { PlanCtx, Result } from '../shared.ts';
import { planEntries } from './records.ts';

/** A refusal for a command or flag that no longer exists: the changelog replaces it. */
export const removed = (what: string): Refusal => new Refusal(`${what} was removed; the changelog in ${OVERVIEW_REL} replaces it.`);

/** Rewrite the OVERVIEW changelog from the checkout at `root`. Returns the repo-relative files that changed. */
export function refreshMemory(root: string, ctx: Ctx): string[] {
  const before = readText(join(root, OVERVIEW_REL));
  const after = renderChangelog(root, planEntries(ctx));
  if (before === after) return [];
  writeText(join(root, OVERVIEW_REL), after);
  return [OVERVIEW_REL];
}

/** Rewrite docs/cairn/USAGE.md from the plan folders' usage.json files under `root`. Returns the repo-relative files that changed. */
export function refreshUsage(root: string): string[] {
  const before = readText(join(root, USAGE_REL));
  const after = renderUsage(root);
  if (before === after) return [];
  writeText(join(root, USAGE_REL), after);
  return [USAGE_REL];
}

/** At close: write the plan's usage.json (when the mod kept a ledger), refresh the OVERVIEW changelog and the usage table, and commit them. Returns the files changed. */
export function writeMemory(pc: PlanCtx, s: State): string[] {
  const root = pc.plan.worktree;
  const changed: string[] = [];
  try {
    const u = planUsage(commonDir(pc.ctx.mainRoot), s.slug);
    if (u) {
      const rel = `${planRelOf(pc.plan)}/usage.json`;
      writeText(join(root, rel), `${JSON.stringify({ ...u, slug: s.slug, closedAt: new Date().toISOString() }, null, 2)}\n`);
      changed.push(rel);
      archiveLedger(commonDir(pc.ctx.mainRoot), s.slug);
    }
  } catch {
    // Usage is extra: a failure here never stops the changelog.
  }
  changed.push(...refreshMemory(root, pc.ctx), ...refreshUsage(root));
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

/** `cairn index`: the recent changelog entries that session start injects. Prints nothing when no plan is closed. */
export function cmdIndex(ctx: Ctx): Result {
  return { message: memoryIndex(ctx.top, () => planEntries(ctx)) };
}
