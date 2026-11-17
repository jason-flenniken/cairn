import { existsSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { git, gitOk } from '../git.ts';
import type { Ctx } from '../locate.ts';
import { DOCS_DIR } from '../paths.ts';
import type { Opts, Result } from '../shared.ts';
import { readText, stripControl } from '../util.ts';
import { planEntries } from './records.ts';

/** The generated system overview, relative to the checkout root. */
export const SYSTEM_REL = `${DOCS_DIR}/SYSTEM.md`;

/** Commits that only touch the overview itself (committing it) never make it behind. */
const OTHER_PATHS = ['--', '.', `:(exclude)${SYSTEM_REL}`];

/** First-lines stamp the writer puts in SYSTEM.md: the commit it was built from and the date. */
const STAMP = /<!--\s*cairn-system:\s*([0-9a-f]{7,40})\s+(\d{4}-\d{2}-\d{2})\s*-->/;
export const stampLine = (sha: string, date: string) => `<!-- cairn-system: ${sha} ${date} -->`;

/** Caps keep the brief small on a long history; the writer is told when a list was cut. */
const MAX_COMMITS = 200;
const MAX_PATHS = 300;
/** Folders never worth a section: generated output, dependencies, tests, docs. */
const SKIP_DIR = /(^|\/)(node_modules|dist|build|coverage|vendor|tests?|__tests__|fixtures|\.[^/]+)(\/|$)|^docs(\/|$)/;

export function readStamp(text: string | undefined): { sha: string; date: string } | undefined {
  const m = text?.match(STAMP);
  return m ? { sha: m[1], date: m[2] } : undefined;
}

/** How many commits HEAD is past the overview's stamp; undefined when there is no overview or its commit is gone. Never throws. */
export function systemBehind(top: string): number | undefined {
  try {
    const stamp = readStamp(readText(join(top, SYSTEM_REL)));
    if (!stamp || !gitOk(['merge-base', '--is-ancestor', stamp.sha, 'HEAD'], top)) return undefined;
    return Number(git(['rev-list', '--count', `${stamp.sha}..HEAD`, ...OTHER_PATHS], top));
  } catch {
    return undefined;
  }
}

/** The session-start line, or '' when there is no overview or it is current. */
export function systemLine(top: string): string {
  const n = systemBehind(top);
  return n ? `cairn: the system overview (${SYSTEM_REL}) is ${n} commit${n === 1 ? '' : 's'} behind; /cairn:system refreshes it.` : '';
}

/** Folders directly holding at least two tracked files, outside generated, test and docs folders. */
export function sourceDirs(files: string[]): string[] {
  const count = new Map<string, number>();
  for (const f of files) {
    const cut = f.lastIndexOf('/');
    const dir = f.slice(0, cut);
    if (cut > 0 && !SKIP_DIR.test(dir)) count.set(dir, (count.get(dir) ?? 0) + 1);
  }
  return [...count].filter(([, n]) => n >= 2).map(([d]) => d).sort();
}

/** `##` headings of the README, in order. */
export const readmeHeadings = (md: string | undefined): string[] =>
  [...(md ?? '').matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => stripControl(m[1]));

/** A path relative to the checkout when it lies inside it, else absolute. */
const shown = (top: string, p: string): string => {
  const r = relative(top, p);
  return r.startsWith('..') ? p : r;
};

export interface SystemBrief {
  path: string;
  exists: boolean;
  head: string;
  date: string;
  /** Rebuild everything: asked for, no overview yet, or its stamp no longer in history. */
  full: boolean;
  why: string;
  stamp?: { sha: string; date: string };
  behind: number;
  commits: string[];
  commitsCut: boolean;
  changed: string[];
  changedCut: boolean;
  records: { title: string; date: string; record?: string; changelog?: string }[];
  readmeHeadings: string[];
  /** Source folders the overview never names by path: candidates for a missing section. */
  gaps: string[];
}

export function systemBrief(ctx: Ctx, wantFull = false): SystemBrief {
  const top = ctx.top;
  const text = readText(join(top, SYSTEM_REL));
  const stamp = readStamp(text);
  const head = git(['rev-parse', '--short', 'HEAD'], top);
  const date = new Date().toLocaleDateString('en-CA');
  const known = !!stamp && gitOk(['merge-base', '--is-ancestor', stamp.sha, 'HEAD'], top);
  const full = wantFull || !known;
  const why = wantFull ? 'asked for a full rebuild' : !text ? 'no overview yet' : !stamp ? 'the overview has no stamp' : !known ? `its commit ${stamp.sha} is no longer in this branch's history` : 'incremental';

  const range = full ? 'HEAD' : `${stamp!.sha}..HEAD`;
  const behind = full ? 0 : Number(git(['rev-list', '--count', range, ...OTHER_PATHS], top));
  const allCommits = full ? [] : git(['log', '--no-merges', '--format=%h %s', range, ...OTHER_PATHS], top).split('\n').filter(Boolean);
  const allChanged = full ? [] : git(['diff', '--name-only', `${stamp!.sha}`, 'HEAD', ...OTHER_PATHS], top).split('\n').filter(Boolean);

  const records = planEntries(ctx)
    .filter((p) => p.state.stage === 'closed' && (p.record || p.changelog))
    .filter((p) => full || allChanged.some((f) => f.includes(`/${basename(p.dir)}/`)))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((p) => ({
      title: stripControl(p.state.title),
      date: p.date,
      ...(p.record ? { record: shown(top, p.record) } : {}),
      ...(p.changelog ? { changelog: shown(top, p.changelog) } : {}),
    }));

  const files = git(['ls-files'], top).split('\n').filter(Boolean);
  const mentioned = text ?? '';
  const gaps = sourceDirs(files).filter((d) => !mentioned.includes(d));
  const readme = ['README.md', 'readme.md'].map((f) => join(top, f)).find((p) => existsSync(p));

  return {
    path: SYSTEM_REL,
    exists: !!text,
    head,
    date,
    full,
    why,
    ...(stamp ? { stamp } : {}),
    behind,
    commits: allCommits.slice(0, MAX_COMMITS),
    commitsCut: allCommits.length > MAX_COMMITS,
    changed: allChanged.slice(0, MAX_PATHS),
    changedCut: allChanged.length > MAX_PATHS,
    records,
    readmeHeadings: readmeHeadings(readme ? readText(readme) : undefined),
    gaps,
  };
}

export function cmdSystem(ctx: Ctx, opts: Opts): Result {
  const b = systemBrief(ctx, opts.full === true);
  const current = !b.full && b.behind === 0;
  const lines = current
    ? [`${b.path} is current (built from ${b.stamp!.sha}).`]
    : [
        `${b.path}: ${b.full ? `full rebuild (${b.why})` : `${b.behind} commit(s) behind ${b.stamp!.sha}`}. Stamp the new version: ${stampLine(b.head, b.date)}`,
        ...(b.records.length ? [`Records (${b.records.length}):`, ...b.records.map((r) => `  ${r.date} ${r.title}: ${r.changelog ?? r.record}`)] : []),
        ...(b.commits.length ? [`Commits since the stamp${b.commitsCut ? ` (newest ${b.commits.length})` : ''}:`, ...b.commits.map((c) => `  ${c}`)] : []),
        ...(b.changed.length ? [`Changed paths: ${b.changed.length}${b.changedCut ? '+' : ''}`] : []),
        ...(b.gaps.length ? [`Source folders the overview does not name: ${b.gaps.join(', ')}`] : []),
      ];
  return { message: lines.join('\n'), data: { ...b, current, stampLine: stampLine(b.head, b.date) } as unknown as Record<string, unknown> };
}
