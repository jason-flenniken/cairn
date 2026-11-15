import { isDone, parentKeys, takenIssues } from './linear.ts';
import { sections } from './sections.ts';
import type { LinearIssue, LinearLink } from './types.ts';

/**
 * Tickets specced by cairn (`/cairn:spec`) carry this label and the sections below as `## ` headings. A plan whose
 * issues all do can build its PRD straight from them (`cairn linear prd`) instead of running the full discover.
 * The contract is `references/linear-tickets.md`.
 */
export const SPEC_LABEL = 'cairn-spec';
export const EPIC_SECTIONS = ['Goal', 'In scope', 'Out of scope', 'Done when'] as const;
export const LEAF_SECTIONS = ['What', 'Done when'] as const;

export interface SpecCheck {
  /** Every in-plan issue carries the label and its sections. */
  ok: boolean;
  /** Why not, one line per issue. Empty when ok. */
  problems: string[];
}

/**
 * The description without collapsed blocks (`+++ Title` … `+++`, `<details>` … `</details>`): /cairn:spec keeps a
 * converted ticket's old text in one, and its bullets and headings must not leak into the sections.
 */
export const specText = (d = ''): string =>
  d.replace(/^\+\+\+[^\n]*\n[\s\S]*?^\+\+\+[ \t]*$/gm, '').replace(/<details[\s\S]*?<\/details>/gi, '');

const stamped = (i: LinearIssue) => !!i.labels?.some((x) => x.toLowerCase() === SPEC_LABEL);

/**
 * Whether the plan's issues are cairn-specced. Undefined when none carries the label (an ordinary Linear plan).
 * `texts` holds each issue's description, by key; an issue with none read counts as missing its sections.
 */
export function specCheck(l: LinearLink, texts: Map<string, string>): SpecCheck | undefined {
  // Issues already done in Linear are not built, so they need no spec.
  const issues = takenIssues(l).filter((i) => !isDone(i));
  if (!issues.some(stamped)) return undefined;
  const parents = parentKeys(issues);
  const problems: string[] = [];
  for (const i of issues) {
    if (!stamped(i)) {
      problems.push(`${i.key} has no "${SPEC_LABEL}" label`);
      continue;
    }
    const text = texts.get(i.key);
    if (text === undefined) {
      problems.push(`${i.key}'s text was not read`);
      continue;
    }
    const have = sections(specText(text));
    const need = parents.has(i.key) ? EPIC_SECTIONS : LEAF_SECTIONS;
    const missing = need.filter((s) => !have.get(s.toLowerCase())?.trim());
    if (missing.length) problems.push(`${i.key} is missing ${missing.map((s) => `## ${s}`).join(', ')}`);
  }
  return { ok: !problems.length, problems };
}

/** The description inside an `issues/<KEY>.md` file, as `issueFile` wrote it. */
export function issueDescription(file: string): string {
  const at = file.indexOf('\n## Description\n');
  return at < 0 ? '' : file.slice(at + '\n## Description\n'.length).trim();
}

/** Decisions recorded as `### <n>. <prefix>: <KEY>` in decisions.md, by key: the answer, plus the why when given. */
export function keyedDecisions(decisionsMd: string, prefix: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(`^### \\d+\\. ${prefix}:\\s*([A-Z][A-Z0-9]*-\\d+)\\s*\\n\\*\\*Decision:\\*\\* (.+)(?:\\n\\*\\*Why:\\*\\* (.+))?`, 'gim');
  for (const m of decisionsMd.matchAll(re)) out.set(m[1].toUpperCase(), m[3] ? `${m[2].trim()}, because ${m[3].trim()}` : m[2].trim());
  return out;
}

const oneLine = (s = '') => s.replace(/\s+/g, ' ').trim();
/** A ticket's own requirement ids (FR-12 in the product spec) would read as this PRD's ids: a non-breaking hyphen keeps them as text. */
const quiet = (s: string) => s.replace(/\bFR-(\d)/g, 'FR‑$1');
const noStop = (s: string) => s.replace(/[.;:,]+$/, '');
/** Bullets joined with "; ", or the paragraph on one line. */
function flat(body = ''): string {
  const bullets = body.split('\n').filter((x) => /^\s*[-*]\s+/.test(x)).map((x) => noStop(x.replace(/^\s*[-*]\s+(\[[ x]\]\s+)?/, '').trim()));
  return quiet(bullets.length ? bullets.join('; ') : noStop(oneLine(body)));
}
const firstParagraph = (body = '') => body.trim().split(/\n\s*\n/)[0] ?? '';

/**
 * prd.md built from specced tickets, with no model: epic Goal is the problem, In scope the solution, each sub-issue
 * one requirement (its What, checked by its Done when, tagged with its key), Out of scope the non-goals. Issues the
 * discover recorded as "Not taken: KEY" and outside blockers recorded as "Outside blocker: KEY" get their sections.
 */
export function renderSpecPrd(title: string, l: LinearLink, texts: Map<string, string>, decisionsMd: string): string {
  const all = l.issues;
  const parents = parentKeys(all);
  const notTaken = keyedDecisions(decisionsMd, 'Not taken');
  const released = (i: LinearIssue) => i.released?.reason ?? notTaken.get(i.key) ?? (isDone(i) ? 'already done in Linear' : undefined);
  const sec = (k: string) => sections(specText(texts.get(k) ?? ''));
  const epics = all.filter((i) => parents.has(i.key));
  const leaves = all.filter((i) => !parents.has(i.key) && !released(i));
  const many = epics.length > 1;
  const perEpic = (name: string, fmt: (body: string) => string) =>
    epics.map((e) => ({ e, body: sec(e.key).get(name) ?? '' })).filter((x) => x.body.trim()).map((x) => (many ? `**${x.e.key}: ${x.e.title}.** ${fmt(x.body)}` : fmt(x.body)));
  const keepText = (b: string) => quiet(b.trim());

  const problem = perEpic('goal', keepText);
  const solution = perEpic('in scope', keepText);
  const nonGoals = perEpic('out of scope', keepText);
  const reqs = leaves.map((i, n) => {
    const s = sec(i.key);
    const what = noStop(quiet(oneLine(firstParagraph(s.get('what'))))) || i.title;
    return `- **FR-${String(n + 1).padStart(2, '0')}** ${what}. Check: ${flat(s.get('done when')) || 'see the ticket'}. [${i.key}]`;
  });
  const notTakenLines = all.filter((i) => !parents.has(i.key) && released(i)).map((i) => `- ${i.key}: ${released(i)}`);
  const blockers = keyedDecisions(decisionsMd, 'Outside blocker');
  const trust = perEpic('trust boundaries', keepText);
  const sources = all.map((i) => ({ i, body: sec(i.key).get('source') ?? '' })).filter((x) => x.body.trim()).map((x) => `- ${x.i.key}: ${quiet(oneLine(x.body))}`);
  const paragraphs = (xs: string[]) => xs.join('\n\n');

  return [
    `# PRD: ${title}`,
    '',
    `> Built from the specced Linear tickets${l.epic ? ` under ${l.epic}` : ''} by \`cairn linear prd\`. The tickets are the source: change them in Linear and rebuild, or edit here before approval.`,
    '',
    '## Problem',
    paragraphs(problem) || `The tickets ${keysOf(leaves)} describe the work.`,
    '',
    '## Solution',
    paragraphs(solution) || leaves.map((i) => `- ${i.title}`).join('\n'),
    '',
    '## Requirements',
    ...reqs,
    '',
    '## Non-goals',
    paragraphs(nonGoals) || '- Anything the tickets do not describe, because the tickets set the scope',
    '',
    '## Open questions',
    '- [x] Do the tickets settle the requirements? (answer: yes, they were specced with /cairn:spec and chosen as the spec at plan start)',
    ...(trust.length ? ['', '## Security', paragraphs(trust)] : []),
    ...(notTakenLines.length ? ['', '## Issues not taken', ...notTakenLines] : []),
    ...(blockers.size ? ['', '## Outside blockers', ...[...blockers].map(([k, v]) => `- ${k}: ${v}`)] : []),
    ...(sources.length ? ['', '## Sources', ...sources] : []),
    '',
  ].join('\n');
}

const keysOf = (xs: LinearIssue[]) => xs.map((i) => i.key).join(', ');
