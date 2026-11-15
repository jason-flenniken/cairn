import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import { parse } from 'yaml';
import { ids, sections } from './sections.ts';
import type { EndProof, EndProofs, State, Task } from './types.ts';

/**
 * End-state proofs: runnable checks, written before the build, that say when the plan is done. Not to be confused
 * with `proof.ts`, which is the proof that a human gave an approval.
 */

const BLOCK = /```ya?ml\s+cairn-proofs\s*\n([\s\S]*?)```/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ParsedProofs {
  list: EndProof[];
  notProvable: { id: string; reason: string }[];
  problems: string[];
}

const strList = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : undefined);

/** A repo-relative path inside the worktree: not absolute, no `..`. */
const safePath = (p: string): boolean => !!p && !isAbsolute(p) && !normalize(p).split(/[\\/]/).includes('..');

/** The PRD's requirement ids. */
export const prdIds = (prdMd: string): string[] => {
  const sec = sections(prdMd);
  return ids(sec.get('requirements') ?? sec.get('functional requirements'));
};

/** Parse proofs.md: the `cairn-proofs` block and the `## Not provable` list, checked against the PRD and plan. */
export function parseProofs(md: string, prdMd: string, planMd: string, worktree: string): ParsedProofs {
  const problems: string[] = [];
  const block = md.match(BLOCK)?.[1];
  if (!block) return { list: [], notProvable: [], problems: ['proofs.md has no ```yaml cairn-proofs block'] };
  let doc: unknown;
  try {
    doc = parse(block);
  } catch (e) {
    return { list: [], notProvable: [], problems: [`cairn-proofs YAML does not parse: ${(e as Error).message}`] };
  }
  const raw = (doc as { proofs?: unknown })?.proofs;
  if (!Array.isArray(raw)) return { list: [], notProvable: [], problems: ['cairn-proofs needs a `proofs:` list'] };
  const reqs = new Set(prdIds(prdMd));
  const seen = new Set<string>();
  const list: EndProof[] = [];
  raw.forEach((r: any, i: number) => {
    const id = String(r?.id ?? '');
    const where = `proof "${id || `#${i + 1}`}"`;
    if (!ID.test(id)) problems.push(`${where}: id must be kebab-case`);
    if (seen.has(id)) problems.push(`proof id "${id}" is used twice`);
    seen.add(id);
    const covers = strList(r?.covers);
    if (!covers?.length) problems.push(`${where}: \`covers\` must list the requirement ids it proves, like [FR-01]`);
    for (const c of covers ?? []) if (!reqs.has(c)) problems.push(`${where}: covers ${c}, which is not a requirement in prd.md`);
    const run = typeof r?.run === 'string' ? r.run.trim() : '';
    if (!run) problems.push(`${where}: \`run\` must be the command that runs it`);
    const files = strList(r?.files);
    if (!files?.length) problems.push(`${where}: \`files\` must list the proof's code, like [proofs/checkout.spec.ts]`);
    for (const f of files ?? []) {
      if (!safePath(f)) problems.push(`${where}: file "${f}" must be a path inside the repo`);
      else if (!existsSync(join(worktree, f))) problems.push(`${where}: file ${f} does not exist in the plan worktree (write and commit it first)`);
    }
    const shots = r?.shots === undefined ? undefined : strList(r.shots);
    if (r?.shots !== undefined && (!shots || shots.some((x) => !ID.test(x)))) problems.push(`${where}: \`shots\` must be a list of kebab-case screenshot names, like [cart, confirm]`);
    const look = typeof r?.look === 'string' ? r.look.trim() : '';
    if (shots?.length && !look) problems.push(`${where}: a proof with shots needs \`look\`: what the screenshots must show, or the path of the approved mockup`);
    if (r?.expect !== undefined && r.expect !== 'pass') problems.push(`${where}: \`expect\` can only be "pass" (a guard proof, green from the start)`);
    list.push({
      id,
      covers: covers ?? [],
      run,
      files: files ?? [],
      ...(shots?.length ? { shots, look } : {}),
      ...(r?.expect === 'pass' ? { expect: 'pass' as const } : {}),
    });
  });
  const notProvable: { id: string; reason: string }[] = [];
  for (const line of (sections(md).get('not provable') ?? '').split('\n')) {
    const m = line.match(/^\s*[-*]\s+(FR-\d+)\s*[:—-]\s*(.*)$/);
    if (!m) continue;
    if (!m[2].trim() || /^<.*>$/.test(m[2].trim())) problems.push(`${m[1]} is listed as not provable with no reason`);
    else notProvable.push({ id: m[1], reason: m[2].trim() });
  }
  const covered = new Set([...list.flatMap((p) => p.covers), ...notProvable.map((n) => n.id)]);
  const deferred = new Set(ids(sections(planMd).get('deferred requirements')));
  const open = [...reqs].filter((r) => !covered.has(r) && !deferred.has(r));
  if (open.length) problems.push(`no proof covers ${open.join(', ')}: add a proof, or list it under ## Not provable with a reason`);
  return { list, notProvable, problems };
}

/** One hash over a proof's files (path and content); a missing file hashes as missing. */
export function filesHash(worktree: string, files: string[]): string {
  const h = createHash('sha256');
  for (const f of [...files].sort()) {
    const p = join(worktree, f);
    h.update(`${f}\0`);
    h.update(existsSync(p) && statSync(p).isFile() ? readFileSync(p) : '<missing>');
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

/** Proofs are enforced on plans started with proofs on (chosen at `cairn new`), or on any plan that loaded some. */
export const proofsRequired = (s: State): boolean => !!s.endProofs?.required && s.track === 'feature';
export const proofsActive = (s: State): boolean => proofsRequired(s) || !!s.endProofs?.list.length;

/** Every file a locked proof owns. */
export const lockedFiles = (ep: EndProofs | undefined): string[] => [...new Set((ep?.list ?? []).filter((p) => p.lock).flatMap((p) => p.files))];

/** The tasks that build what a proof covers. */
export const tasksFor = (p: EndProof, tasks: Task[]): Task[] => tasks.filter((t) => t.covers.some((c) => p.covers.includes(c)));

/** A proof is due once every task that builds what it covers is done: before then, red is expected. */
export const isDue = (p: EndProof, tasks: Task[]): boolean => tasksFor(p, tasks).every((t) => t.status === 'done');

/** The proofs a task answers for, and the other tasks each still waits on. */
export function proofsOfTask(ep: EndProofs | undefined, t: Task, tasks: Task[]): { proof: EndProof; waitsOn: Task[] }[] {
  return (ep?.list ?? [])
    .filter((p) => t.covers.some((c) => p.covers.includes(c)))
    .map((proof) => ({ proof, waitsOn: tasksFor(proof, tasks).filter((x) => x.id !== t.id && x.status !== 'done') }));
}
