import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commonDir } from '../git.ts';
import { taskBranch, type Ctx } from '../locate.ts';
import { findTask } from '../ready.ts';
import { sections } from '../sections.ts';
import { loadState, log } from '../state.ts';
import { SUGGESTION_AREAS, type MustFix, type Suggestion, type State, type Task } from '../types.ts';
import { CliError, readText, Refusal } from '../util.ts';
import { mutate, planCtx, planFile, type Opts, type PlanCtx, type Result } from '../shared.ts';
import { logFollowUp } from './suggest.ts';
import { CAIRN_DIR } from '../paths.ts';

// ---------- The work directory ----------

export type Role = 'build' | 'review' | 'security' | 'fix';
const ROLES: readonly Role[] = ['build', 'review', 'security', 'fix'];

/** `<plan worktree>/.cairn/work/<slug>/`, made on demand with `briefs/`, `reports/` and `research/`. A `.gitignore` of `*` keeps it out of the repo. */
export function workDir(pc: PlanCtx): string {
  const root = join(pc.plan.worktree, CAIRN_DIR, 'work');
  const dir = join(root, pc.plan.slug);
  for (const sub of ['briefs', 'reports', 'research']) mkdirSync(join(dir, sub), { recursive: true });
  const ignore = join(root, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
  return dir;
}

/** The work folder when it already holds files (no folder is made): for the session-start line. */
export function workDirIfUsed(worktree: string, slug: string): string | undefined {
  const dir = join(worktree, CAIRN_DIR, 'work', slug);
  try {
    const used = ['briefs', 'reports', 'research'].some((sub) => readdirSync(join(dir, sub)).length > 0);
    return used ? dir : undefined;
  } catch {
    return undefined;
  }
}

export const reportPath = (pc: PlanCtx, task: string, role: Role): string => join(workDir(pc), 'reports', `${task}-${role}.md`);

// ---------- Reading the plan and the PRD ----------

/** The `### Task: <id>` section of plan.md, verbatim, up to the next heading of the same or a higher level. */
export function taskSection(planMd: string, id: string): string | undefined {
  const lines = planMd.split('\n');
  let start = -1;
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fenced = !fenced;
    if (!fenced && start < 0 && new RegExp(`^###\\s+Task:\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`).test(lines[i])) start = i;
    else if (!fenced && start >= 0 && /^#{1,3}\s/.test(lines[i])) return lines.slice(start, i).join('\n').trim();
  }
  return start < 0 ? undefined : lines.slice(start).join('\n').trim();
}

/** The PRD's requirement text for an FR id: its bullet and the lines indented under it. */
export function requirementText(prdMd: string, fr: string): string | undefined {
  const sec = sections(prdMd);
  const body = sec.get('requirements') ?? sec.get('functional requirements');
  if (!body) return undefined;
  const lines = body.split('\n');
  const head = new RegExp(`^\\s*[-*]\\s+\\*\\*${fr}\\*\\*`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < lines.length && !/^\s*[-*]\s+\*\*FR-\d+\*\*/.test(lines[end]) && !/^#{1,6}\s/.test(lines[end])) end++;
  return lines.slice(start, end).join('\n').trim();
}

const clean = (md: string) => md.replace(/<!--[\s\S]*?-->/g, '').trim();

// ---------- task brief ----------

const taskBits = (pc: PlanCtx, s: State, sl: Task) => {
  const branch = sl.branch ?? taskBranch(pc.plan.slug, sl.id);
  const planMd = readText(planFile(pc, 'plan.md')) ?? '';
  const prdMd = readText(planFile(pc, 'prd.md')) ?? '';
  const section = taskSection(planMd, sl.id) ?? `(plan.md has no "### Task: ${sl.id}" section; build from the task line in the plan: ${sl.name}, covers ${sl.covers.join(', ') || 'nothing'}, scope ${sl.scope.join(', ')})`;
  const reqs = sl.covers.map((fr) => requirementText(prdMd, fr) ?? `- **${fr}** (not found in prd.md)`);
  const constraints = clean(sections(planMd).get('global constraints') ?? '');
  return { branch, section, reqs, constraints, plan: s.branch };
};

const list = (items: string[]) => items.map((x) => `- ${x}`).join('\n');

function buildBrief(pc: PlanCtx, s: State, sl: Task, role: Role): { text: string; report: string } {
  const b = taskBits(pc, s, sl);
  const report = reportPath(pc, sl.id, role);
  const worktree = sl.worktree ?? '(not started: run `cairn task start` first)';
  const where = [`Plan worktree: ${pc.plan.worktree}`, `Plan branch: ${b.plan}`, `Task branch: ${b.branch}`, `Task worktree: ${worktree}`];
  const head = `# ${role === 'build' ? 'Build' : role === 'fix' ? 'Fix' : role === 'security' ? 'Security review' : 'Review'}: ${sl.name} (${sl.id})`;
  const parts = [head, '', ...where, ''];
  if (role === 'fix') {
    const found = sl.mustFix ?? [];
    parts.push('## What to fix', '');
    if (sl.mergeConflict?.length)
      parts.push(`Merge ${b.plan} into ${b.branch} in ${worktree}, resolve the conflicts, and commit. Conflicting files:`, list(sl.mergeConflict), '');
    if (found.length) parts.push(...found.map((f, i) => `${i + 1}. ${f.label} | ${f.area} | ${f.cls} | ${f.where} | ${f.problem} | ${f.fix}`), '');
    else if (!sl.mergeConflict?.length) parts.push('No must-fix findings are recorded for this task. Check the reviewer reports under reports/.', '');
    parts.push('## Task', '', b.section, '');
  } else {
    parts.push('## Task', '', b.section, '', '## Requirements this task covers', '', b.reqs.length ? b.reqs.join('\n\n') : 'None (a prefactor task).', '');
    if (b.constraints) parts.push('## Global constraints', '', b.constraints, '');
    if (role !== 'build') {
      parts.push('## What to review', '', `Diff: \`git -C ${pc.plan.worktree} diff ${b.plan}...${b.branch}\``, `The implementer's report: ${reportPath(pc, sl.id, 'build')}`, '');
    }
  }
  parts.push('## Report', '', `Write your full report to: ${report}`);
  return { text: parts.join('\n') + '\n', report };
}

/** Write the brief for a task and role. Used by `cairn task brief` and `cairn task start`. */
export function writeBrief(pc: PlanCtx, id: string, role: Role): { path: string; report: string; name: string } {
  const s = loadState(pc.plan.dir);
  const sl = findTask(s, id);
  if (!sl) throw new Refusal(`no task "${id}" in this plan`, ['cairn ready']);
  const { text, report } = buildBrief(pc, s, sl, role);
  const path = join(workDir(pc), 'briefs', `${id}-${role}.md`);
  writeFileSync(path, text);
  return { path, report, name: sl.name };
}

export function taskBrief(pc: PlanCtx, id: string, opts: Opts): Result {
  const role = opts.role === undefined ? 'build' : String(opts.role);
  if (!(ROLES as readonly string[]).includes(role)) throw new CliError(`--role must be one of ${ROLES.join(', ')}`);
  const r = writeBrief(pc, id, role as Role);
  return { message: `Brief for ${role} · ${r.name}: ${r.path}. Report to: ${r.report}.`, data: { path: r.path, report: r.report, role } };
}

// ---------- Parsing reports ----------

const AREAS = SUGGESTION_AREAS as readonly string[];
const area = (v: string): Suggestion['area'] => (AREAS.includes(v.toLowerCase()) ? (v.toLowerCase() as Suggestion['area']) : 'quality');
/** `src/x.ts:40` -> `src/x.ts`; a path with no line stays as it is. Nothing usable gives no scope. */
const pathOf = (where: string): string[] => {
  const p = where.trim().replace(/:\d+(?:-\d+)?$/, '');
  return p && !/\s/.test(p) && p !== '-' && p.toLowerCase() !== 'n/a' ? [p] : [];
};

const readReport = (path: string): string => {
  const md = readText(path);
  if (md === undefined) throw new Refusal(`no report at ${path}`, ['the agent writes its full report to the path in its brief']);
  return md;
};

/** The follow-up lines of an implementer report: inline after `Suggestions:` or one per line below it. */
export function reportSuggestions(md: string): { area: Suggestion['area']; where: string[]; text: string }[] {
  const lines = md.split('\n');
  const at = lines.findIndex((l) => /^\s*[*_]*Suggestions[*_]*\s*:/i.test(l));
  if (at < 0) return [];
  const raw = [lines[at].replace(/^\s*[*_]*Suggestions[*_]*\s*:[*_]*\s*/i, '')];
  for (const l of lines.slice(at + 1)) {
    if (!l.trim() || /^#{1,6}\s/.test(l) || /^\s*[*_]*[A-Z][\w /]*[*_]*\s*:(\s|$)/.test(l)) break;
    raw.push(l);
  }
  const out: { area: Suggestion['area']; where: string[]; text: string }[] = [];
  for (const line of raw) {
    const f = line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim().split(/\s+\|\s+/);
    if (f.length < 3 || !AREAS.includes(f[0].trim().toLowerCase())) continue;
    const text = f.slice(2).join(' | ').trim();
    if (!text) continue;
    out.push({ area: f[0].trim().toLowerCase() as Suggestion['area'], where: f[1].split(/\s*,\s*/).map((w) => w.trim()).filter((w) => w && w !== '-'), text });
  }
  return out;
}

export function taskReport(ctx: Ctx, id: string | undefined, path: string | undefined): Result {
  if (!id || !path) throw new CliError('usage: cairn task report <task-id> <report-path>');
  const pc = planCtx(ctx);
  const md = readReport(path);
  const status = md.match(/^\s*[*_]*Status[*_]*\s*:[*_]*\s*([A-Za-z_]+)/im)?.[1]?.toUpperCase();
  if (!status) throw new Refusal(`the report at ${path} has no Status: line`, ['the implementer ends its report with the Status / Commits / Files / Tests / Concerns / Suggestions lines']);
  const found = reportSuggestions(md);
  return mutate(pc, undefined, (s) => {
    const sl = findTask(s, id);
    if (!sl) throw new Refusal(`no task "${id}" in this plan`, ['cairn ready']);
    let logged = 0;
    for (const f of found) if (logFollowUp(s, { ...f, from: 'implementer' }, true)) logged++;
    log(s, 'task report', `${sl.name}: ${status}, ${logged} follow-ups`);
    return { message: `${status}; ${logged} follow-ups logged.`, data: { status, logged } };
  });
}

// ---------- review record ----------

const FINDING = /^\s*(?:\d+[.)]|[-*])?\s*[*_]*(Critical|Required|Optional|Nit|FYI)[*_]*(\s+pre-existing)?\s*\|\s*(.*)$/i;

export interface Finding extends MustFix {
  preExisting: boolean;
}

/** Finding lines: `N. <Label>[ pre-existing] | <area> | <class> | path:line | problem | proposed fix`. Anything else is skipped. */
export function parseFindings(md: string): Finding[] {
  const out: Finding[] = [];
  for (const line of md.split('\n')) {
    const m = line.match(FINDING);
    if (!m) continue;
    const f = m[3].split(/\s+\|\s+/).map((x) => x.trim());
    if (f.length < 4) continue;
    const label = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    const fix = f.length >= 5 ? f[f.length - 1] : '';
    out.push({ label: label === 'Fyi' ? 'FYI' : label, area: f[0].toLowerCase(), cls: f[1], where: f[2], problem: f.slice(3, f.length >= 5 ? -1 : undefined).join(' | '), fix, report: '', preExisting: !!m[2] });
  }
  return out;
}

export function cmdReview(ctx: Ctx, action: string | undefined, target: string | undefined, path: string | undefined): Result {
  if (action !== 'record' || !target || !path) throw new CliError('usage: cairn review record <task-id|branch> <report-path>');
  const pc = planCtx(ctx);
  const md = readReport(path);
  const findings = parseFindings(md);
  const must = findings.filter((f) => (f.label === 'Critical' || f.label === 'Required') && !f.preExisting);
  const ride = findings.filter((f) => f.label !== 'FYI' && !must.includes(f));
  const said = md.match(/^\s*[*_]*Verdict[*_]*\s*:[*_]*\s*(PASS|FIX)/im)?.[1]?.toUpperCase();
  if (said === 'FIX' && !must.length)
    throw new Refusal(`the report at ${path} says FIX but has no Critical or Required finding line to record`, ['the reviewer lists each blocking finding as "N. Critical|Required | <area> | <class> | path:line | problem | proposed fix"']);
  const from: Suggestion['from'] = target === 'branch' ? (/security/i.test(path) ? 'security-review' : 'branch-review') : /security/i.test(path) ? 'security-review' : 'task-review';
  return mutate(pc, undefined, (s) => {
    const mine: MustFix[] = must.map(({ preExisting: _p, ...rest }) => ({ ...rest, report: path }));
    if (target === 'branch') s.branchMustFix = [...(s.branchMustFix ?? []).filter((x) => x.report !== path), ...mine];
    else {
      const sl = findTask(s, target);
      if (!sl) throw new Refusal(`no task "${target}" in this plan`, ['cairn ready', 'or use `branch` for the whole-branch review']);
      sl.mustFix = [...(sl.mustFix ?? []).filter((x) => x.report !== path), ...mine];
      if (!sl.mustFix.length) delete sl.mustFix;
    }
    if (target === 'branch' && !s.branchMustFix?.length) delete s.branchMustFix;
    let logged = 0;
    for (const f of ride) {
      const text = `${f.problem}${f.fix ? ` Fix: ${f.fix}` : ''}`.trim();
      if (!text) continue;
      if (logFollowUp(s, { area: area(f.area), text, where: pathOf(f.where), from }, true)) logged++;
    }
    log(s, 'review recorded', `${target}: ${mine.length} must-fix, ${logged} follow-ups`);
    const verdict = mine.length ? 'FIX' : 'PASS';
    const tail = `${logged} logged as follow-ups.`;
    const message = mine.length ? `FIX: ${mine.length} must-fix (${mine.map((f) => `${f.area}: ${f.where}`).join('; ')}); ${tail}` : `PASS: ${tail}`;
    return { message, data: { verdict, mustFix: mine.map(({ report: _r, ...rest }) => rest), logged } };
  });
}

// ---------- Fresh start ----------

const DEFAULT_FRESH_START_AT = 40;
const FRESH_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * The context percentage the mod last wrote for this plan's session, when it is recent and over the limit.
 * A missing, old or unreadable file is nothing: this never fails a command.
 */
export function freshStart(pc: PlanCtx, at: number = Date.now()): { pct: number; line: string } | undefined {
  try {
    const raw = readText(join(commonDir(pc.ctx.mainRoot), 'cairn', 'context', `${pc.plan.slug}.json`));
    if (raw === undefined) return undefined;
    const c = JSON.parse(raw) as { pct?: unknown; at?: unknown };
    if (typeof c.pct !== 'number' || !Number.isFinite(c.pct) || typeof c.at !== 'string') return undefined;
    const t = Date.parse(c.at);
    if (!Number.isFinite(t) || at - t > FRESH_MAX_AGE_MS || t - at > FRESH_MAX_AGE_MS) return undefined;
    const limit = typeof pc.cfg.freshStartAt === 'number' ? pc.cfg.freshStartAt : DEFAULT_FRESH_START_AT;
    if (c.pct < limit) return undefined;
    const pct = Math.round(c.pct);
    return { pct, line: `Context is at ${pct}%. Everything is saved: start fresh with /clear, then /cairn:next.` };
  } catch {
    return undefined;
  }
}

/** Adds the start-fresh line (and `data.freshStart`) to a stage-end result when the context is high. */
export function withFreshStart(pc: PlanCtx, r: Result): Result {
  const f = freshStart(pc);
  if (!f) return r;
  return { message: r.message ? `${r.message}\n${f.line}` : f.line, data: { ...r.data, freshStart: { pct: f.pct } } };
}
