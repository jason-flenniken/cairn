import { parse } from 'yaml';
import { ids, missingSections, PLAN_SECTIONS, sections } from './sections.ts';
import type { Complexity, Phase, Task } from './types.ts';
import { SLUG } from './util.ts';
import { MODELS, type Model } from './builder.ts';

const BLOCK = /```ya?ml\s+cairn-tasks\s*\n([\s\S]*?)```/;
const COMPLEXITY: Complexity[] = ['simple', 'standard', 'complex'];
const KINDS = ['prefactor'];

export interface ParsedPlan {
  phases: Phase[];
  problems: string[];
}

/** A YAML list of strings, or a problem naming the field. Absent is fine (empty); any other shape is reported, not read as empty. */
function strList(v: unknown, field: string, where: string, problems: string[]): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v;
  problems.push(`${where}: \`${field}\` must be a list of strings, like [a, b]`);
  return [];
}

/** Parse and validate plan.md against the PRD's requirement ids. */
export function parsePlan(planMd: string, prdMd: string): ParsedPlan {
  const problems: string[] = [];
  const missing = missingSections(planMd, PLAN_SECTIONS);
  if (missing.length) problems.push(`plan.md is missing sections: ${missing.join(', ')}`);

  const block = planMd.match(BLOCK)?.[1];
  if (!block) return { phases: [], problems: [...problems, 'plan.md has no ```yaml cairn-tasks block under ## Phases'] };

  let doc: unknown;
  try {
    doc = parse(block);
  } catch (e) {
    return { phases: [], problems: [...problems, `cairn-tasks YAML does not parse: ${(e as Error).message}`] };
  }
  const rawPhases = (doc as { phases?: unknown })?.phases;
  if (!Array.isArray(rawPhases) || rawPhases.length === 0)
    return { phases: [], problems: [...problems, 'cairn-tasks needs a non-empty `phases:` list'] };

  const prdSections = sections(prdMd);
  const requirements = prdSections.get('requirements') ?? prdSections.get('functional requirements');
  const prdIds = new Set(ids(requirements));
  problems.push(...badRequirementIds(requirements));
  const phases: Phase[] = [];
  const phaseOf = new Map<string, number>();
  const seenPhase = new Set<string>();

  rawPhases.forEach((rp: any, pi: number) => {
    const pid = String(rp?.id ?? '');
    if (!SLUG.test(pid)) problems.push(`phase #${pi + 1}: id "${pid}" must be kebab-case`);
    if (seenPhase.has(pid)) problems.push(`phase id "${pid}" is used twice`);
    seenPhase.add(pid);
    const tasks: Task[] = [];
    const rawTasks: unknown[] = Array.isArray(rp?.tasks) ? rp.tasks : [];
    if (rp?.tasks !== undefined && rp?.tasks !== null && !Array.isArray(rp.tasks)) problems.push(`phase "${pid}": \`tasks\` must be a list of tasks`);
    else if (rawTasks.length === 0) problems.push(`phase "${pid}" has no tasks`);
    for (const rs of rawTasks as any[]) {
      if (!rs || typeof rs !== 'object' || Array.isArray(rs)) {
        problems.push(`phase "${pid}": each task must be a mapping with id, covers, scope and so on`);
        continue;
      }
      const sid = String(rs?.id ?? '');
      const where = `task "${sid}"`;
      if (!SLUG.test(sid)) problems.push(`${where}: id must be kebab-case`);
      if (phaseOf.has(sid)) problems.push(`${where}: id is used twice`);
      phaseOf.set(sid, pi);
      const covers = strList(rs.covers, 'covers', where, problems);
      const blockedBy = strList(rs.blocked_by, 'blocked_by', where, problems);
      const scope = strList(rs.scope, 'scope', where, problems);
      const complexity = (rs?.complexity ?? 'standard') as Complexity;
      const kind = rs?.kind === undefined ? undefined : String(rs.kind);
      if (kind !== undefined && !KINDS.includes(kind)) problems.push(`${where}: kind must be ${KINDS.join(' or ')}, or left out`);
      if (!covers.length && kind !== 'prefactor') problems.push(`${where}: \`covers\` must list the PRD FR ids it implements (only kind: prefactor may leave it empty)`);
      for (const c of covers) if (!prdIds.has(c)) problems.push(`${where}: covers ${c}, which is not in the PRD's Requirements`);
      if (!scope.length) problems.push(`${where}: \`scope\` must list the file globs it may touch`);
      if (!COMPLEXITY.includes(complexity)) problems.push(`${where}: complexity must be simple, standard, or complex`);
      const model = rs?.model === undefined ? undefined : String(rs.model);
      if (model !== undefined && !MODELS.includes(model as Model)) problems.push(`${where}: model must be ${MODELS.join(', ')}, or left out`);
      const modelReason = typeof rs?.model_reason === 'string' && rs.model_reason.trim() ? rs.model_reason.trim() : undefined;
      if (model !== undefined && MODELS.includes(model as Model) && !modelReason) problems.push(`${where} asks for ${model} without saying why: add model_reason`);
      if (model === undefined && rs?.model_reason !== undefined) problems.push(`${where} has model_reason but no model: add model, or take model_reason out`);
      const risky = rs?.risky === true;
      if (rs?.risky !== undefined && typeof rs.risky !== 'boolean') problems.push(`${where}: risky must be true or false`);
      const riskReason = typeof rs?.riskReason === 'string' && rs.riskReason.trim() ? rs.riskReason.trim() : undefined;
      const ticket = rs?.ticket === undefined ? undefined : typeof rs.ticket === 'string' && rs.ticket.trim() ? rs.ticket.trim() : undefined;
      if (rs?.ticket !== undefined && !ticket) problems.push(`${where}: ticket must be a short title, or left out`);
      tasks.push({ id: sid, name: String(rs?.name ?? sid), ...(kind === 'prefactor' ? { kind } : {}), covers, ...(ticket ? { ticket } : {}), blockedBy, scope, complexity, ...(model && modelReason && MODELS.includes(model as Model) ? { model: model as Model, modelReason } : {}), status: 'pending', fixRound: 0, risky, ...(risky && riskReason ? { riskReason } : {}) });
    }
    if (rp?.overlap !== undefined && typeof rp.overlap !== 'boolean') problems.push(`phase "${pid}": overlap must be true or false`);
    if (rp?.overlap === true && pi === 0) problems.push(`phase "${pid}": the first phase has nothing to overlap with; leave out overlap`);
    phases.push({ id: pid, name: String(rp?.name ?? pid), status: 'pending', ...(rp?.overlap === true && pi > 0 ? { overlap: true } : {}), tasks });
  });

  // blocked_by: known ids, same or earlier phase, no cycles.
  const all = phases.flatMap((p) => p.tasks);
  for (const [pi, p] of phases.entries())
    for (const s of p.tasks)
      for (const b of s.blockedBy) {
        if (!phaseOf.has(b)) problems.push(`task "${s.id}": blocked_by "${b}" is not a task in this plan`);
        else if (phaseOf.get(b)! > pi) problems.push(`task "${s.id}": blocked_by "${b}" is in a later phase`);
      }
  const cycle = findCycle(all);
  if (cycle) problems.push(`blocked_by has a cycle: ${cycle.join(' → ')}`);

  // Every FR is covered or explicitly deferred.
  const covered = new Set(all.flatMap((s) => s.covers));
  const deferred = new Set(ids(sections(planMd).get('deferred requirements')));
  const uncovered = [...prdIds].filter((id) => !covered.has(id) && !deferred.has(id));
  if (uncovered.length)
    problems.push(`PRD requirements not covered by any task: ${uncovered.join(', ')}. Cover them or list them under ## Deferred requirements`);

  return { phases, problems };
}

/** Bold ids that look like requirement ids but are not FR-<digits>, which coverage would silently skip (FR-39). */
function badRequirementIds(requirements = ''): string[] {
  const bad = new Set<string>();
  for (const m of requirements.matchAll(/\*\*([^*]+)\*\*/g)) {
    const id = m[1].trim().split(/\s+/)[0].replace(/[.:,;]+$/, '');
    if (/^fr[-_\d]/i.test(id) && !/^FR-\d+$/.test(id)) bad.add(id);
  }
  return [...bad].map((id) => `PRD requirement id "${id}" must have the form FR-<digits>`);
}

function findCycle(tasks: Task[]): string[] | undefined {
  const deps = new Map(tasks.map((s) => [s.id, s.blockedBy]));
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): string[] | undefined => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 1);
    stack.push(id);
    for (const d of deps.get(id) ?? []) {
      const c = visit(d);
      if (c) return c;
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const s of tasks) {
    const c = visit(s.id);
    if (c) return c;
  }
}

/** Keep progress of tasks that survive a re-plan. */
export function mergeProgress(next: Phase[], prev: Phase[]): { phases: Phase[]; lostDone: string[] } {
  const old = new Map(prev.flatMap((p) => p.tasks).map((s) => [s.id, s]));
  const kept = new Set<string>();
  for (const p of next)
    for (const [i, s] of p.tasks.entries()) {
      const o = old.get(s.id);
      if (!o) continue;
      kept.add(s.id);
      p.tasks[i] = { ...s, status: o.status, substep: o.substep, fixRound: o.fixRound, branch: o.branch, worktree: o.worktree, base: o.base, tip: o.tip, tests: o.tests, testedCommit: o.testedCommit, doneAt: o.doneAt, startedAt: o.startedAt, note: o.note };
    }
  const lostDone = [...old.values()].filter((s) => s.status !== 'pending' && !kept.has(s.id)).map((s) => s.id);
  for (const p of next) p.status = phaseStatus(p, prev.find((q) => q.id === p.id)?.status);
  return { phases: next, lostDone };
}

export function phaseStatus(p: Phase, prior?: Phase['status']): Phase['status'] {
  if (p.tasks.every((s) => s.status === 'done')) return prior === 'done' ? 'done' : 'awaiting_approval';
  if (p.tasks.some((s) => s.status !== 'pending') || prior === 'in_progress') return 'in_progress';
  return 'pending';
}
