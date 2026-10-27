import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { matchesAny, scopesOverlap } from './glob.ts';
import { DOCS_DIR } from './paths.ts';
import { readText, SLUG } from './util.ts';

export const SYSTEM_DIR = `${DOCS_DIR}/system`;

/** One living area doc: what part of the code it covers and a one-line summary. */
export interface Area {
  id: string;
  name: string;
  summary: string;
  paths: string[];
  /** Repo-relative path of the doc. */
  file: string;
}

/** The block between a leading `---` line and the next `---` line; undefined when there is none. */
export function parseFrontmatter(md: string): { data: Record<string, unknown>; body: string } | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!m) return undefined;
  const data = parse(m[1]);
  return { data: data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}, body: m[2] };
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Read every `docs/cairn/system/*.md` under a checkout root. Bad docs are reported and left out. */
export function loadAreas(root: string): { areas: Area[]; problems: string[] } {
  const areas: Area[] = [];
  const problems: string[] = [];
  const dir = join(root, SYSTEM_DIR);
  if (!existsSync(dir)) return { areas, problems };
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const file = `${SYSTEM_DIR}/${name}`;
    const id = name.slice(0, -3);
    if (!SLUG.test(id)) {
      problems.push(`${file} file name must be kebab-case`);
      continue;
    }
    let fm: ReturnType<typeof parseFrontmatter>;
    try {
      fm = parseFrontmatter(readText(join(dir, name)) ?? '');
    } catch (e) {
      problems.push(`${file} frontmatter is not valid YAML: ${(e as Error).message.split('\n')[0]}`);
      continue;
    }
    if (!fm) {
      problems.push(`${file} has no frontmatter`);
      continue;
    }
    const { area, summary, paths } = fm.data;
    if (!Array.isArray(paths) || paths.length === 0 || !paths.every(nonEmpty)) {
      problems.push(`${file} needs a non-empty paths list`);
      continue;
    }
    if (!nonEmpty(area) || !nonEmpty(summary)) {
      problems.push(`${file} needs area and summary`);
      continue;
    }
    areas.push({ id, name: area, summary, paths: paths as string[], file });
  }
  return { areas: areas.sort((a, b) => a.id.localeCompare(b.id)), problems };
}

export const areasForFile = (file: string, areas: Area[]): Area[] => areas.filter((a) => matchesAny(file, a.paths));

export const areasForScopes = (globs: string[], areas: Area[]): Area[] => areas.filter((a) => scopesOverlap(globs, a.paths));
