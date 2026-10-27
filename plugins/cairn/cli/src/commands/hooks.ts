import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DOCS_DIR, isCairnPath } from '../paths.ts';
import { matchesAny } from '../glob.ts';
import { context } from '../locate.ts';
import { allTasks, currentPhase, findTask } from '../ready.ts';
import { nextFor, summary } from '../render.ts';
import { loadState, log, saveState } from '../state.ts';
import { now, withLock } from '../util.ts';
import { planCtx } from '../shared.ts';
import { listPlans, warnings } from './status.ts';

interface HookInput {
  cwd?: string;
  tool_input?: { file_path?: string; notebook_path?: string };
}

const hookOut = (event: string, text: string) => JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });

export function hookSessionStart(input: HookInput): string {
  const ctx = context(input.cwd ?? process.cwd());
  if (ctx.plan?.dir && existsSync(join(ctx.plan.dir, 'state.json'))) {
    const pc = planCtx(ctx);
    const s = loadState(pc.plan.dir);
    if (s.stage === 'closed') return '';
    const lines = [`cairn: ${summary(s)}`, `Next: ${nextFor(s).text} The user runs /cairn:next to continue.`, ...warnings(pc, s).map((w) => `Warning: ${w}`)];
    if (ctx.task) {
      const sl = findTask(s, ctx.task);
      if (sl) lines.push(`This worktree is task "${sl.name}". Touch only: ${sl.scope.join(', ')}. Never edit ${DOCS_DIR}/.`);
    }
    return hookOut('SessionStart', lines.join('\n'));
  }
  const active = listPlans(ctx).filter((r) => r.state.stage !== 'closed');
  if (!active.length) return '';
  return hookOut('SessionStart', [`cairn: ${active.length} active plan(s) in this repo:`, ...active.map((r) => `- ${summary(r.state)}`), 'The user can resume one with /cairn:resume <slug> or start another with /cairn:new.'].join('\n'));
}

export function hookPostEdit(input: HookInput): string {
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (!file) return '';
  // Subagents keep the session's cwd but edit by absolute path in their task worktree,
  // so the worktree (and therefore the plan and task) comes from the file, not the cwd.
  const abs = isAbsolute(file) ? file : resolve(input.cwd ?? process.cwd(), file);
  let dir = dirname(abs);
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  const ctx = context(dir);
  if (!ctx.plan?.dir || !existsSync(join(ctx.plan.dir, 'state.json'))) return '';
  const rel = relative(ctx.top, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) return '';
  if (isCairnPath(rel)) return '';
  const pc = planCtx(ctx);
  const logged = withLock(pc.plan.dir, () => {
    const s = loadState(pc.plan.dir);
    if (s.stage === 'closed') return '';
    let allowed: string[];
    let where: string;
    const task = ctx.task ? findTask(s, ctx.task) : undefined;
    if (['discover', 'prd', 'plan'].includes(s.stage)) {
      allowed = ['docs/**'];
      where = 'before the plan was approved';
    } else if (task) {
      allowed = task.scope;
      where = `outside task "${task.name}" scope`;
    } else if (s.stage === 'execute') {
      allowed = (currentPhase(s)?.tasks ?? []).flatMap((x) => x.scope);
      where = "outside the current phase's scope";
    } else {
      allowed = allTasks(s).flatMap((x) => x.scope);
      where = "outside the plan's scope";
    }
    if (matchesAny(rel, allowed)) return '';
    if (s.drift.some((d) => d.path === rel && !d.acked)) return '';
    s.drift.push({ path: rel, at: now(), reason: `edited ${where}`, ...(task ? { task: task.id } : {}) });
    log(s, 'drift', rel);
    saveState(pc.plan.dir, s);
    return `${rel} was edited ${where}`;
  });
  return logged ? hookOut('PostToolUse', `cairn: ${logged}. Logged as out-of-scope; it is listed in the phase summary. If this was not intended, revert it.`) : '';
}
