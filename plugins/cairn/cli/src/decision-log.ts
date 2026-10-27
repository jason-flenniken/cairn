import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { parseFrontmatter } from './areas.ts';
import { scopesOverlap } from './glob.ts';
import { DOCS_DIR } from './paths.ts';
import type { PendingDecision } from './types.ts';
import { readText } from './util.ts';

export const DECISIONS_DIR = `${DOCS_DIR}/decisions`;

/** One lasting decision in the repo-wide log, with its replaced-by link. */
export interface LoggedDecision {
  id: string;
  question: string;
  answer: string;
  why?: string;
  status: 'active' | 'replaced';
  replacedBy?: string;
  replaces?: string;
  areas: string[];
  paths: string[];
  plan: string;
  date: string;
  /** Repo-relative path of the decision file. */
  file: string;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : v instanceof Date ? v.toISOString().slice(0, 10) : undefined);

function parseDecision(name: string, text: string): { d: LoggedDecision; body: string } | undefined {
  let fm: ReturnType<typeof parseFrontmatter>;
  try {
    fm = parseFrontmatter(text);
  } catch {
    return undefined;
  }
  if (!fm) return undefined;
  const { id, status, replaced_by, replaces, areas, paths, plan, date } = fm.data;
  const q = /^# (.+)$/m.exec(fm.body);
  const a = /\*\*Decision:\*\* ([\s\S]*?)(?:\n\n\*\*Why:\*\* |\s*$)/.exec(fm.body);
  const w = /\n\n\*\*Why:\*\* ([\s\S]*?)\s*$/.exec(fm.body);
  if (!str(id) || (status !== 'active' && status !== 'replaced') || !q || !a || !str(plan) || !str(date)) return undefined;
  return {
    body: fm.body,
    d: {
      id: str(id)!,
      question: q[1],
      answer: a[1],
      why: w?.[1],
      status,
      replacedBy: str(replaced_by),
      replaces: str(replaces),
      areas: strings(areas),
      paths: strings(paths),
      plan: str(plan)!,
      date: str(date)!,
      file: `${DECISIONS_DIR}/${name}`,
    },
  };
}

/** Frontmatter in the fixed key order; keys with no value are left out. */
function render(d: LoggedDecision, body: string): string {
  const fm: Record<string, unknown> = { id: d.id, status: d.status };
  if (d.replacedBy) fm.replaced_by = d.replacedBy;
  if (d.replaces) fm.replaces = d.replaces;
  if (d.areas.length) fm.areas = d.areas;
  if (d.paths.length) fm.paths = d.paths;
  fm.plan = d.plan;
  fm.date = d.date;
  return `---\n${stringify(fm)}---\n${body}`;
}

const bodyOf = (p: PendingDecision): string => `\n# ${p.question}\n\n**Decision:** ${p.answer}\n${p.why ? `\n**Why:** ${p.why}\n` : ''}`;

function readAll(root: string): { d: LoggedDecision; body: string }[] {
  const dir = join(root, DECISIONS_DIR);
  if (!existsSync(dir)) return [];
  const out: { d: LoggedDecision; body: string }[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const parsed = parseDecision(name, readText(join(dir, name)) ?? '');
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Every readable decision under a checkout root; unreadable files are skipped. */
export const loadDecisions = (root: string): LoggedDecision[] => readAll(root).map((x) => x.d);

/** `<date>-<first six words of the question>`, with `-2`, `-3`... when taken. */
export function decisionId(date: string, question: string, taken: Set<string>): string {
  const words = question.toLowerCase().replace(/[^a-z0-9]+/g, '-').split('-').filter(Boolean).slice(0, 6).join('-');
  const base = `${date}-${words}`.replace(/^-+|-+$/g, '');
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Active decisions whose paths overlap the globs or whose areas include one of the ids. */
export function activeDecisionsFor(globs: string[], areaIds: string[], all: LoggedDecision[]): LoggedDecision[] {
  return all.filter((d) => d.status === 'active' && (d.areas.some((a) => areaIds.includes(a)) || (d.paths.length > 0 && scopesOverlap(globs, d.paths))));
}

/** Write one file per pending decision and mark what each replaces. Repeats (same plan and question) are skipped. Returns repo-relative files written or changed. */
export function publishDecisions(root: string, plan: string, date: string, pending: PendingDecision[]): string[] {
  const existing = readAll(root);
  const taken = new Set(existing.map((x) => x.d.id));
  const written: string[] = [];
  const dir = join(root, DECISIONS_DIR);
  for (const p of pending) {
    if (existing.some((x) => x.d.plan === plan && x.d.question === p.question)) continue;
    mkdirSync(dir, { recursive: true });
    const id = decisionId(date, p.question, taken);
    taken.add(id);
    const d: LoggedDecision = { id, question: p.question, answer: p.answer, why: p.why, status: 'active', replaces: p.replaces, areas: p.areas, paths: p.paths, plan, date, file: `${DECISIONS_DIR}/${id}.md` };
    writeFileSync(join(root, d.file), render(d, bodyOf(p)));
    written.push(d.file);
    const old = p.replaces ? existing.find((x) => x.d.id === p.replaces) : undefined;
    if (old) {
      old.d.status = 'replaced';
      old.d.replacedBy = id;
      writeFileSync(join(root, old.d.file), render(old.d, old.body));
      written.push(old.d.file);
    }
    existing.push({ d, body: bodyOf(p) });
  }
  return written;
}
