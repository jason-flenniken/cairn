import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DOCS_DIR, DOCS_DIRS, isCairnPath } from '../paths.ts';
import { matchesAny } from '../glob.ts';
import { context, planRelOf } from '../locate.ts';
import { allTasks, currentPhase, findTask } from '../ready.ts';
import { nextFor, summary } from '../render.ts';
import { loadState, log, saveState } from '../state.ts';
import { now, pluginRoot, withLock } from '../util.ts';
import { planCtx } from '../shared.ts';
import { memoryIndex } from '../memory.ts';
import { planEntries } from './records.ts';
import { legacyLayout } from './migrate.ts';
import { listPlans, warnings } from './status.ts';
import { awaitsDone, pendingCount } from './linear.ts';
import { workDirIfUsed } from './brief.ts';
import { systemLine } from './system.ts';
import { bashVerdict, pathProtected, WHY } from '../../../hooks/mod/guard-rules.ts';

interface HookInput {
  cwd?: string;
  tool_name?: string;
  /** Claude Code: `file_path` / `notebook_path`. Codex: `command` holds the shell command, or the apply_patch text. */
  tool_input?: { file_path?: string; notebook_path?: string; command?: unknown; cmd?: unknown };
  /** Stop: true when this turn already continued because of a Stop hook. */
  stop_hook_active?: boolean;
  last_assistant_message?: string;
  transcript_path?: string;
}

/** Codex sets PLUGIN_ROOT for plugin hooks (Claude Code sets only CLAUDE_PLUGIN_ROOT): the host has no cairn mod. */
const codexRoot = (): string | undefined => process.env.PLUGIN_ROOT || undefined;

/** The files an apply_patch envelope touches: added, updated, deleted, and the targets of moves. */
export function patchPaths(patch: string): string[] {
  const out = new Set<string>();
  for (const m of patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+?)\s*$/gm)) out.add(m[1]);
  return [...out];
}

/** The shell command text in a hook's tool input, whichever field and shape the host uses. */
function commandText(input: HookInput): string | undefined {
  const c = input.tool_input?.command ?? input.tool_input?.cmd;
  if (typeof c === 'string') return c;
  if (Array.isArray(c) && c.every((x) => typeof x === 'string')) return c.join(' ');
  return undefined;
}

/**
 * Where a write to `path` lands: the deepest existing ancestor with symlinks resolved, then the missing rest.
 * Undefined when that can't be told (`~`, `..` past a missing folder); the guard then denies, as the mod does.
 */
function landing(path: string, cwd: string): string | undefined {
  if (path === '' || path.startsWith('~')) return undefined;
  const abs = isAbsolute(path) ? path : resolve(cwd, path);
  const parts = abs.split('/');
  for (let cut = parts.length; cut >= 1; cut--) {
    const head = parts.slice(0, cut).join('/') || '/';
    if (!existsSync(head)) continue;
    const rest = parts.slice(cut).filter((x) => x !== '' && x !== '.');
    if (rest.includes('..')) return undefined;
    return [realpathSync(head).replace(/\/$/, ''), ...rest].join('/');
  }
  return undefined;
}

const denyOut = (reason: string) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

/**
 * PreToolUse for hosts without the cairn mod (Codex): the same rules the mod's guards apply. A Bash command goes
 * through the shell deny-list; an apply_patch may not write plan state or cairn's folder under .git. Best effort,
 * like the mod: input sent later to a running command (write_stdin) never comes back through this hook.
 */
export function hookPreTool(input: HookInput): string {
  const cmd = commandText(input);
  if (input.tool_name === 'apply_patch') {
    for (const path of patchPaths(cmd ?? '')) {
      const real = landing(path, input.cwd ?? process.cwd());
      if (real === undefined) return denyOut(`cairn: cannot tell where ${path} lands, so the edit is refused.`);
      if (pathProtected(real)) return denyOut(`cairn: ${path} is plan state or cairn's own folder; ${WHY}`);
    }
    return '';
  }
  if (cmd === undefined) return '';
  const { deny } = bashVerdict(cmd);
  return deny ? denyOut(deny) : '';
}

const hookOut = (event: string, text: string) => JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });

/** The recent changelog (newest closed plans, one line each), or '' when there is none or it cannot be read; a broken memory never blocks a session. */
function indexFor(ctx: ReturnType<typeof context>): string {
  try {
    return memoryIndex(ctx.top, () => planEntries(ctx));
  } catch {
    return '';
  }
}

const startOut = (...parts: string[]) => {
  const root = codexRoot();
  // Codex never puts a plugin's bin/ on PATH, and a `cairn` found there may be another host's older copy.
  if (root) parts.push(`cairn CLI here: ${join(root, 'cli', 'bin', 'cairn')}. Run it by that path wherever a cairn step says \`cairn\`; plugin root: ${root}. Host notes: ${join(root, 'references', 'hosts.md')}.`);
  const text = parts.filter(Boolean).join('\n');
  return text ? hookOut('SessionStart', text) : '';
};

/**
 * Puts cli/bin on PATH for the session's Bash commands, so skills can run plain `cairn`. Claude Code puts only a
 * plugin's top-level bin/ on PATH, and claude.ai and Cowork refuse to install a plugin that has one. Claude Code
 * hands SessionStart hooks CLAUDE_ENV_FILE for this; the line is written once per file and never blocks a session.
 */
export function exportPath(envFile = process.env.CLAUDE_ENV_FILE): void {
  if (!envFile || codexRoot()) return;
  try {
    const line = `export PATH='${join(pluginRoot(), 'cli', 'bin').replaceAll("'", "'\\''")}':"$PATH"\n`;
    if (existsSync(envFile) && readFileSync(envFile, 'utf8').includes(line)) return;
    appendFileSync(envFile, line);
  } catch {
    // An unwritable env file leaves the skills' `node dist/cairn.mjs` fallback.
  }
}

/**
 * A line for each plan whose branch merged while nobody ran cairn, so its Linear issues are not marked Done: in a plan
 * worktree only that plan (another session's plan is not this session's to act on), on main each one `cairn next` there
 * routes to. Local git only, no `gh`: a hook never waits on the network. Never fails a session.
 */
function mergedLines(ctx: ReturnType<typeof context>): string {
  try {
    const line = (title: string) => `cairn: ${title}'s pull request is merged; run /cairn:next to mark its Linear issues Done.`;
    if (ctx.plan) {
      const dir = ctx.plan.dir;
      const s = dir && existsSync(join(dir, 'state.json')) ? loadState(dir) : undefined;
      return s && awaitsDone(ctx, s, true) ? line(s.title) : '';
    }
    return listPlans(ctx)
      .filter((r) => r.worktree && awaitsDone(ctx, r.state, true))
      .map((r) => line(r.state.title))
      .join('\n');
  } catch {
    return '';
  }
}

export function hookSessionStart(input: HookInput): string {
  exportPath();
  const ctx = context(input.cwd ?? process.cwd());
  const owed = mergedLines(ctx);
  if (ctx.plan?.dir && existsSync(join(ctx.plan.dir, 'state.json'))) {
    const pc = planCtx(ctx);
    const s = loadState(pc.plan.dir);
    if (s.stage === 'closed') return startOut('', owed, indexFor(ctx), systemLine(ctx.top));
    const lines = [`cairn: ${summary(s)}`, `Next: ${nextFor(s).text} The user runs /cairn:next to continue.`, ...warnings(pc, s).map((w) => `Warning: ${w}`)];
    const queued = pendingCount(s);
    if (queued) lines.push(`${queued} Linear update${queued === 1 ? '' : 's'} waiting to be sent; /cairn:next sends them first.`);
    const work = workDirIfUsed(pc.plan.worktree, s.slug);
    if (work) lines.push(`Briefs and reports: ${work}`);
    if (ctx.task) {
      const sl = findTask(s, ctx.task);
      if (sl) lines.push(`This worktree is task "${sl.name}". Touch only: ${sl.scope.join(', ')}. Never edit ${DOCS_DIRS.find((d) => planRelOf(pc.plan).startsWith(`${d}/`)) ?? DOCS_DIR}/.`);
    }
    return startOut(lines.join('\n'), owed, indexFor(ctx), systemLine(ctx.top));
  }
  const active = listPlans(ctx).filter((r) => r.state.stage !== 'closed');
  if (!active.length) {
    const legacy = legacyLayout(ctx.mainRoot);
    return startOut(legacy.length ? `cairn: this repo still uses ${legacy.join(' and ')}; run \`cairn migrate\` on main to move them.` : '', owed, indexFor(ctx), systemLine(ctx.top));
  }
  return startOut([`cairn: ${active.length} active plan(s) in this repo:`, ...active.map((r) => `- ${summary(r.state)}`), 'The user can resume one with /cairn:resume <slug> or start another with /cairn:new.'].join('\n'), owed, indexFor(ctx), systemLine(ctx.top));
}

/** A reply that says it is about to do the next step: "Next: I'm reading…", "Starting it now", "I'll begin the interview". */
const ANNOUNCES = [
  /(^|\n)\s*(\*\*)?Next(:\*\*|\*\*:|:)\s*(I|I'm|I'll|I am|I will|we'll|we will|starting|running|reading|dispatching|moving|continuing|beginning|opening)\b/i,
  /\b(I'll|I will|I'm going to|Let me)\s+(now\s+)?(start|begin|continue|move|run|read|dispatch|kick off|open)\b/i,
  /\b(Starting|Continuing|Moving on|Kicking off|Beginning)\b[^.\n]*\bnow\b/i,
];

/** The last assistant text of the turn: from the Stop input when the host sends it, else the tail of the transcript. */
function lastAssistantText(input: HookInput): string {
  if (typeof input.last_assistant_message === 'string') return input.last_assistant_message;
  if (!input.transcript_path || !existsSync(input.transcript_path)) return '';
  const lines = readFileSync(input.transcript_path, 'utf8').trimEnd().split('\n');
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 50; i--) {
    try {
      const row = JSON.parse(lines[i]);
      if (row.type !== 'assistant') continue;
      const content = row.message?.content;
      const text = Array.isArray(content) ? content.filter((b: { type?: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n') : '';
      if (text) return text;
    } catch {}
  }
  return '';
}

/**
 * Stop: a turn that ends on a reply announcing the next step ("Next: I'm reading the discover steps…") while a plan is
 * mid-flight is the model stopping by accident, since a reply with no tool call ends the turn. Send it on, once.
 */
export function hookStop(input: HookInput): string {
  if (input.stop_hook_active) return '';
  const ctx = context(input.cwd ?? process.cwd());
  if (!ctx.plan?.dir || !existsSync(join(ctx.plan.dir, 'state.json'))) return '';
  const s = loadState(ctx.plan.dir);
  if (s.stage === 'closed' || s.paused) return '';
  const text = lastAssistantText(input).trim();
  if (!text || text.endsWith('?') || !ANNOUNCES.some((re) => re.test(text))) return '';
  return JSON.stringify({
    decision: 'block',
    reason: 'cairn: your reply said what comes next but ended the turn, and a reply with no tool call is a stop. Do that step now: run `cairn next --json` and follow the procedure it names. Once the PRD is approved the run does not wait on the user: make the call (--call), or record what is not done (--not-done), and go on to the pull request. Before that, ask with AskUserQuestion.',
  });
}

export function hookPostEdit(input: HookInput): string {
  const one = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  const files = one ? [one] : input.tool_name === 'apply_patch' ? patchPaths(commandText(input) ?? '') : [];
  const notes = files.map((f) => driftFor(f, input.cwd)).filter(Boolean);
  if (!notes.length) return '';
  return hookOut('PostToolUse', notes.map((n) => `cairn: ${n}. Logged as out-of-scope; it is listed in the phase summary. If this was not intended, revert it.`).join('\n'));
}

/** Log one edited file as drift when it falls outside what the plan, phase or task may touch; returns the note, or ''. */
function driftFor(file: string, cwd: string | undefined): string {
  // Subagents keep the session's cwd but edit by absolute path in their task worktree,
  // so the worktree (and therefore the plan and task) comes from the file, not the cwd.
  const abs = isAbsolute(file) ? file : resolve(cwd ?? process.cwd(), file);
  let dir = dirname(abs);
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  const ctx = context(dir);
  if (!ctx.plan?.dir || !existsSync(join(ctx.plan.dir, 'state.json'))) return '';
  const rel = relative(ctx.top, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) return '';
  if (isCairnPath(rel) || rel === '.cairn/work' || rel.startsWith('.cairn/work/')) return '';
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
  return logged;
}
