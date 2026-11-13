import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { builderLine, builderOf, type Builder } from '../builder.ts';
import { commonDir } from '../git.ts';
import { taskBranch, type Ctx } from '../locate.ts';
import { findTask } from '../ready.ts';
import { sections } from '../sections.ts';
import { levelOf, loadState, log } from '../state.ts';
import { SUGGESTION_AREAS, type MustFix, type Suggestion, type State, type Task } from '../types.ts';
import { CliError, now, readText, Refusal } from '../util.ts';
import { ensureExcluded, mutate, planCtx, planFile, planScope, type Opts, type PlanCtx, type Result, type TestRun } from '../shared.ts';
import { logFollowUp } from './suggest.ts';
import { CAIRN_DIR } from '../paths.ts';

// ---------- The work directory ----------

export type Role = 'build' | 'review' | 'security' | 'fix';
const ROLES: readonly Role[] = ['build', 'review', 'security', 'fix'];

/** `<plan worktree>/.cairn/work/<slug>/`, made on demand with `briefs/`, `reports/` and `research/`. A `.gitignore` of `*` keeps it out of the repo. */
export function workDir(pc: PlanCtx): string {
  const root = join(pc.plan.worktree, CAIRN_DIR, 'work');
  const dir = join(root, pc.plan.slug);
  ensureExcluded(pc.ctx.mainRoot, `${CAIRN_DIR}/work/`);
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

const classHeading = (cls: string) => cls.trim() || 'unclassified';

/** One must-fix line: `N. label | area | class | where | problem | fix`. */
const mustLine = (f: MustFix, n: number) => `${n}. ${f.label} | ${f.area} | ${f.cls} | ${f.where} | ${f.problem} | ${f.fix}`;

/** The task facts every brief carries: what the plan says about the task, and where the PRD and the plan are. */
function factsBlock(pc: PlanCtx, sl: Task): string[] {
  return [
    '## Task facts',
    '',
    `- Scope: ${sl.scope.join(', ') || '(none)'}`,
    `- Risky: ${sl.risky ? `yes${sl.riskReason ? ` (${sl.riskReason})` : ''}` : 'no'}`,
    `- Complexity: ${sl.complexity}`,
    ...(sl.model ? [`- Builder model: ${sl.model} (${sl.modelReason})`] : []),
    `- Blocked by: ${sl.blockedBy.join(', ') || 'nothing'}`,
    `- PRD: ${planFile(pc, 'prd.md')}`,
    `- Plan: ${planFile(pc, 'plan.md')}`,
    '',
  ];
}

/** The PRD's Security section, quoted for the security reviewer. */
function securityBlock(pc: PlanCtx): string[] {
  const prd = readText(planFile(pc, 'prd.md')) ?? '';
  const body = clean(sections(prd).get('security') ?? '');
  return ['## PRD security section', '', body || '(the PRD has no Security section: review against the security checklist alone)', ''];
}

/** The must-fix a reviewer's earlier report left on the task. */
const priorMustFix = (sl: Task, report: string): MustFix[] => (sl.mustFix ?? []).filter((x) => x.report === report);

function buildBrief(pc: PlanCtx, s: State, sl: Task, role: Role, again = false): { text: string; report: string } {
  const b = taskBits(pc, s, sl);
  const report = reportPath(pc, sl.id, role);
  const worktree = sl.worktree ?? '(not started: run `cairn task start` first)';
  const where = [`Plan worktree: ${pc.plan.worktree}`, `Plan branch: ${b.plan}`, `Task branch: ${b.branch}`, `Task worktree: ${worktree}`];
  const title = role === 'build' ? 'Build' : role === 'fix' ? 'Fix' : role === 'security' ? 'Security review' : 'Review';
  const head = `# ${again ? `Re-${title.charAt(0).toLowerCase()}${title.slice(1)}` : title}: ${sl.name} (${sl.id})`;
  const parts = [head, '', ...where, '', ...factsBlock(pc, sl)];
  if (role === 'fix') {
    const found = sl.mustFix ?? [];
    parts.push('## What to fix', '');
    if (sl.mergeConflict?.length)
      parts.push(`Merge ${b.plan} into ${b.branch} in ${worktree}, resolve the conflicts, and commit. Conflicting files:`, list(sl.mergeConflict), '');
    if (found.length) {
      // Grouped by class, in the order each class first appears; the numbering runs on across groups.
      const classes = [...new Set(found.map((f) => classHeading(f.cls)))];
      let n = 0;
      for (const c of classes) parts.push(`### ${c}`, '', ...found.filter((f) => classHeading(f.cls) === c).map((f) => mustLine(f, ++n)), '');
    } else if (!sl.mergeConflict?.length) parts.push('No must-fix findings are recorded for this task. Check the reviewer reports under reports/.', '');
    if (s.lastRed) parts.push('## Last red test run', '', ...(s.lastRed.failing.length ? s.lastRed.failing.map((l) => `  ${l}`) : ['  (no failing line was picked out)']), `Full output: ${s.lastRed.log}`, '');
    parts.push('## Task', '', b.section, '');
  } else {
    parts.push('## Task', '', b.section, '', '## Requirements this task covers', '', b.reqs.length ? b.reqs.join('\n\n') : 'None (a prefactor task).', '');
    if (b.constraints) parts.push('## Global constraints', '', b.constraints, '');
    if (role === 'security') parts.push(...securityBlock(pc));
    if (role !== 'build') {
      parts.push('## What to review', '', `Diff: \`git -C ${pc.plan.worktree} diff ${b.plan}...${b.branch}\``, `The implementer's report: ${reportPath(pc, sl.id, 'build')}`, '');
      if (again) {
        const prior = priorMustFix(sl, report);
        parts.push(
          '## Re-review',
          '',
          'This is a second look after a fix. The must-fix you recorded last time:',
          prior.length ? prior.map((f, i) => mustLine(f, i + 1)).join('\n') : '(none is recorded: say so in the report)',
          '',
          `The fix report: ${reportPath(pc, sl.id, 'fix')}`,
          '',
          'List each prior item as one line: `Prior: <path:line> | addressed|open | <note>`. Report anything the fix newly broke as normal finding lines. End with `Verdict: PASS` or `Verdict: FIX`.',
          '',
        );
      }
    }
  }
  parts.push('## Report', '', `Write your full report to: ${report}`);
  return { text: parts.join('\n') + '\n', report };
}

/** Write the brief for a task and role. Used by `cairn task brief` and `cairn task start`. */
export function writeBrief(pc: PlanCtx, id: string, role: Role, again = false): { path: string; report: string; name: string; builder: Builder } {
  const s = loadState(pc.plan.dir);
  const sl = findTask(s, id);
  if (!sl) throw new Refusal(`no task "${id}" in this plan`, ['cairn ready']);
  const { text, report } = buildBrief(pc, s, sl, role, again);
  const path = join(workDir(pc), 'briefs', `${id}-${role}${again ? '-again' : ''}.md`);
  writeFileSync(path, text);
  return { path, report, name: sl.name, builder: builderOf(s, sl, role === 'fix' ? sl.fixRound : 0) };
}

export function taskBrief(pc: PlanCtx, id: string, opts: Opts): Result {
  const role = opts.role === undefined ? 'build' : String(opts.role);
  if (!(ROLES as readonly string[]).includes(role)) throw new CliError(`--role must be one of ${ROLES.join(', ')}`);
  const again = !!opts.again;
  if (again && role !== 'review' && role !== 'security') throw new CliError('--again needs --role review or --role security');
  const r = writeBrief(pc, id, role as Role, again);
  const builds = role === 'build' || role === 'fix';
  return {
    message: `Brief for ${again ? 're-' : ''}${role} · ${r.name}: ${r.path}. Report to: ${r.report}.${builds ? `\n${builderLine(r.builder)}` : ''}`,
    data: { path: r.path, report: r.report, role, ...(builds ? { builder: r.builder } : {}) },
  };
}

// ---------- Red test runs ----------

const FAILING = /\b(?:fail(?:ed|ing|ure)?|error)\b|✗|✖|^not ok\b/i;

/** Up to five lines that name a failure, in order. */
export const failingLines = (output: string): string[] => output.split('\n').filter((l) => FAILING.test(l)).slice(0, 5).map((l) => (l.length > 200 ? `${l.slice(0, 199)}…` : l));

/** Writes a red run's output to <work>/reports/tests.log and returns the path. */
export function testLog(pc: PlanCtx, output: string): string {
  const path = join(workDir(pc), 'reports', 'tests.log');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${output}\n`);
  return path;
}

/**
 * Keeps what a test run found: a red run (one that actually ran) writes its full output to the log and records
 * `state.lastRed`; a green run clears it. The run gets `log` and `failing` so its refusal can name the file.
 * Called right after the tests run and before any gate, so a refusal still leaves the record.
 */
export function recordTestRun(pc: PlanCtx, t: TestRun | undefined): TestRun | undefined {
  if (!t || (!t.ok && !t.ran)) return t;
  if (t.ok) {
    if (loadState(pc.plan.dir).lastRed) mutate(pc, undefined, (s) => void delete s.lastRed);
    return t;
  }
  t.log = testLog(pc, t.output ?? '');
  t.failing = failingLines(t.output ?? '');
  const { log: logFile, failing } = t as { log: string; failing: string[] };
  mutate(pc, undefined, (s) => {
    s.lastRed = { at: now(), log: logFile, failing };
  });
  return t;
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
  path = resolve(ctx.cwd, path);
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
const LABEL_CELL = /^[*_]*(Critical|Required|Optional|Nit|FYI)[*_]*(\s+pre-existing)?$/i;
/** A finding location: `path`, `path:line` or `path:a-b`, never prose. */
const looksLikeWhere = (x: string): boolean => /^[^\s|]+$/.test(x) && (/[/.]/.test(x) || /:\d/.test(x));

export interface Finding extends MustFix {
  preExisting: boolean;
}

/** A finding line split into its label, pre-existing flag and fields; a table row (`| Critical | … |`) is read cell by cell. */
function splitFinding(line: string): { label: string; pre: boolean; fields: string[] } | undefined {
  const t = line.trim();
  if (t.startsWith('|')) {
    const cells = t.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
    if (cells.length && /^\d+[.)]?$/.test(cells[0])) cells.shift();
    const m = cells[0]?.match(LABEL_CELL);
    return m ? { label: m[1], pre: !!m[2], fields: cells.slice(1) } : undefined;
  }
  const m = line.match(FINDING);
  return m ? { label: m[1], pre: !!m[2], fields: m[3].split(/\s+\|\s+/).map((x) => x.trim()) } : undefined;
}

/**
 * Finding lines: `N. <Label>[ pre-existing] | <area> | <class> | path:line | problem | proposed fix`, or the same as a
 * table row. A line with no class column (area | path:line | problem | fix) is re-aligned with the class "unclassified".
 * Anything else is skipped.
 */
export function parseFindings(md: string): Finding[] {
  const out: Finding[] = [];
  for (const line of md.split('\n')) {
    const m = splitFinding(line);
    if (!m) continue;
    let f = m.fields;
    // Four fields whose second looks like a location and whose third does not: the class column is missing.
    if (f.length >= 4 && looksLikeWhere(f[1]) && !looksLikeWhere(f[2])) f = [f[0], 'unclassified', ...f.slice(1)];
    if (f.length < 4) continue;
    const label = m.label[0].toUpperCase() + m.label.slice(1).toLowerCase();
    const fix = f.length >= 5 ? f[f.length - 1] : '';
    out.push({ label: label === 'Fyi' ? 'FYI' : label, area: f[0].toLowerCase(), cls: f[1], where: f[2], problem: f.slice(3, f.length >= 5 ? -1 : undefined).join(' | '), fix, report: '', preExisting: m.pre });
  }
  return out;
}

export interface PriorLine {
  where: string;
  open: boolean;
  note: string;
}

/** Re-review lines: `Prior: <path:line> | addressed|open | <note>`. A line with another status word is skipped. */
export function parsePrior(md: string): PriorLine[] {
  const out: PriorLine[] = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\s*(?:\d+[.)]|[-*])?\s*[*_]*Prior[*_]*\s*:[*_]*\s*(.*)$/i);
    if (!m) continue;
    const f = m[1].split(/\s+\|\s+/).map((x) => x.trim());
    const st = f[1]?.toLowerCase();
    if (f.length < 2 || (st !== 'open' && st !== 'addressed')) continue;
    out.push({ where: f[0], open: st === 'open', note: f.slice(2).join(' | ') });
  }
  return out;
}

/** A report file written by a security reviewer: decided by the file's own name (`<task>-security.md`, `branch-security.md`), never its folders. */
const isSecurityReport = (path: string): boolean => /(^|-)security\.md$/i.test(basename(path));

export function cmdReview(ctx: Ctx, action: string | undefined, target: string | undefined, path: string | undefined): Result {
  if (action !== 'record' || !target || !path) throw new CliError('usage: cairn review record <task-id|branch> <report-path>');
  const pc = planCtx(ctx);
  path = resolve(ctx.cwd, path);
  const md = readReport(path);
  const findings = parseFindings(md);
  const must = findings.filter((f) => (f.label === 'Critical' || f.label === 'Required') && !f.preExisting);
  const ride = findings.filter((f) => f.label !== 'FYI' && !must.includes(f));
  const stillOpen = parsePrior(md).filter((p) => p.open);
  const said = md.match(/^\s*[*_]*Verdict[*_]*\s*:[*_]*\s*(PASS|FIX)/im)?.[1]?.toUpperCase();
  if (said === 'FIX' && !must.length && !stillOpen.length)
    throw new Refusal(`the report at ${path} says FIX but has no Critical or Required finding line to record`, ['the reviewer lists each blocking finding as "N. Critical|Required | <area> | <class> | path:line | problem | proposed fix"']);
  const security = isSecurityReport(path);
  const from: Suggestion['from'] = security ? 'security-review' : target === 'branch' ? 'branch-review' : 'task-review';
  const reportPath = path;
  return mutate(pc, undefined, (s) => {
    const before = target === 'branch' ? s.branchMustFix ?? [] : findTask(s, target)?.mustFix ?? [];
    // A prior item still open stays must-fix: it keeps what the first review said about it, with the re-review's note.
    const carried: MustFix[] = stillOpen.map((p) => {
      const was = before.find((x) => x.report === reportPath && x.where === p.where);
      return { label: was?.label ?? 'Required', area: was?.area ?? 'quality', cls: was?.cls ?? 'unclassified', where: p.where, problem: p.note || was?.problem || 'still open after the fix', fix: was?.fix ?? '', report: reportPath };
    });
    const mine: MustFix[] = [...must.map(({ preExisting: _p, ...rest }) => ({ ...rest, report: reportPath })), ...carried];
    if (target === 'branch') s.branchMustFix = [...(s.branchMustFix ?? []).filter((x) => x.report !== reportPath), ...mine];
    else {
      const sl = findTask(s, target);
      if (!sl) throw new Refusal(`no task "${target}" in this plan`, ['cairn ready', 'or use `branch` for the whole-branch review']);
      sl.mustFix = [...(sl.mustFix ?? []).filter((x) => x.report !== reportPath), ...mine];
      if (!sl.mustFix.length) delete sl.mustFix;
    }
    if (target === 'branch' && !s.branchMustFix?.length) delete s.branchMustFix;
    const mvp = levelOf(s) === 'mvp';
    let logged = 0;
    for (const f of ride) {
      const text = `${f.problem}${f.fix ? ` Fix: ${f.fix}` : ''}`.trim();
      if (!text) continue;
      // At MVP what the review would have fixed is filed as hardening, found later by path; the item is never empty of one.
      const where = pathOf(f.where);
      const item = mvp ? { area: area(f.area), text, where: where.length ? where : planScope(s), from, kind: 'hardening' as const } : { area: area(f.area), text, where, from };
      if (logFollowUp(s, item, true)) logged++;
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
