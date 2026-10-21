import { parse } from 'yaml';
import { ids, missingSections, PLAN_SECTIONS, sections } from './sections.ts';
import type { Complexity, Phase, Task } from './types.ts';
import { SLUG } from './util.ts';

const BLOCK = /```ya?ml\s+cairn-tasks\s*\n([\s\S]*?)```/;
const COMPLEXITY: Complexity[] = ['simple', 'standard', 'complex'];
const KINDS = ['prefactor'];

export interface ParsedPlan {
  phases: Phase[];
  problems: string[];
}

const strList = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : undefined;

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

  const requirements = sections(prdMd).get('functional requirements');
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
    if (!Array.isArray(rp?.tasks) || rp.tasks.length === 0) problems.push(`phase "${pid}" has no tasks`);
    for (const rs of rp?.tasks ?? []) {
      const sid = String(rs?.id ?? '');
      const where = `task "${sid}"`;
      if (!SLUG.test(sid)) problems.push(`${where}: id must be kebab-case`);
      if (phaseOf.has(sid)) problems.push(`${where}: id is used twice`);
      phaseOf.set(sid, pi);
      const covers = strList(rs?.covers) ?? [];
      const blockedBy = strList(rs?.blocked_by ?? []) ?? [];
      const scope = strList(rs?.scope) ?? [];
      const complexity = (rs?.complexity ?? 'standard') as Complexity;
      const kind = rs?.kind === undefined ? undefined : String(rs.kind);
      if (kind !== undefined && !KINDS.includes(kind)) problems.push(`${where}: kind must be ${KINDS.join(' or ')}, or left out`);
      if (!covers.length && kind !== 'prefactor') problems.push(`${where}: \`covers\` must list the PRD FR ids it implements (only kind: prefactor may leave it empty)`);
      for (const c of covers) if (!prdIds.has(c)) problems.push(`${where}: covers ${c}, which is not in the PRD's Functional requirements`);
      if (!scope.length) problems.push(`${where}: \`scope\` must list the file globs it may touch`);
      if (!COMPLEXITY.includes(complexity)) problems.push(`${where}: complexity must be simple, standard, or complex`);
      tasks.push({ id: sid, name: String(rs?.name ?? sid), ...(kind === 'prefactor' ? { kind } : {}), covers, blockedBy, scope, complexity, status: 'pending', fixRound: 0 });
    }
    phases.push({ id: pid, name: String(rp?.name ?? pid), status: 'pending', tasks });
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
      p.tasks[i] = { ...s, status: o.status, substep: o.substep, fixRound: o.fixRound, branch: o.branch, worktree: o.worktree, base: o.base, tip: o.tip, tests: o.tests, doneAt: o.doneAt, note: o.note };
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
