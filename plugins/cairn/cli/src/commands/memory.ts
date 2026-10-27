import { join } from 'node:path';
import { commitPaths } from '../git.ts';
import type { Ctx } from '../locate.ts';
import { memoryIndex, OVERVIEW_REL, renderChangelog } from '../memory.ts';
import { loadState } from '../state.ts';
import type { State } from '../types.ts';
import { readText, Refusal, writeText } from '../util.ts';
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

/** `cairn index`: the recent changelog entries that session start injects. Prints nothing when no plan is closed. */
export function cmdIndex(ctx: Ctx): Result {
  return { message: memoryIndex(ctx.top, () => planEntries(ctx)) };
}
