import { parse } from 'yaml';

const BLOCK = /```ya?ml[ \t]+cairn-direction[ \t]*\r?\n([\s\S]*?)```/g;
const VERDICTS = ['aligned', 'partial', 'missing', 'contradicted'] as const;
const CLASSES = ['pulled-forward', 'unplanned', 'non-goal-breach', 'supporting'] as const;
/** A file path, a colon, and a line number or range. */
const PATH_LINE = /^\S.*:\d+(-\d+)?$/;

export type RowVerdict = (typeof VERDICTS)[number];
export type UnplannedClass = (typeof CLASSES)[number];
export interface ReqRow { id: string; verdict: RowVerdict; evidence: string; note?: string }
export interface UnplannedRow { what: string; class: UnplannedClass; evidence: string }
export interface Scorecard { requirements: ReqRow[]; unplanned: UnplannedRow[]; nfr: ReqRow[] }

const empty = (): Scorecard => ({ requirements: [], unplanned: [], nfr: [] });

/** Find the one `yaml cairn-direction` block in a direction report and validate its rows. */
export function parseScorecard(md: string): { rows: Scorecard; problems: string[] } {
  const blocks = [...md.replace(/\r\n/g, '\n').matchAll(BLOCK)];
  if (!blocks.length) return { rows: empty(), problems: ['the report has no ```yaml cairn-direction block'] };
  if (blocks.length > 1) return { rows: empty(), problems: ['the report has more than one cairn-direction block; keep exactly one'] };
  let doc: any;
  try {
    doc = parse(blocks[0][1]);
  } catch (e) {
    return { rows: empty(), problems: [`cairn-direction YAML does not parse: ${(e as Error).message}`] };
  }
  const problems: string[] = [];
  const list = (key: string): any[] => {
    const v = doc?.[key] ?? [];
    if (!Array.isArray(v)) {
      problems.push(`\`${key}\` must be a list`);
      return [];
    }
    return v;
  };
  const evidence = (label: string, r: any) => {
    if (typeof r?.evidence !== 'string' || !PATH_LINE.test(r.evidence.trim())) problems.push(`${label}: evidence must be path:line (got ${JSON.stringify(r?.evidence)})`);
  };
  const rows = empty();
  for (const key of ['requirements', 'nfr'] as const)
    for (const r of list(key)) {
      const label = `${key} row ${r?.id ?? '(no id)'}`;
      if (typeof r?.id !== 'string' || !r.id) problems.push(`${label}: needs an id`);
      if (!VERDICTS.includes(r?.verdict)) problems.push(`${label}: verdict must be one of ${VERDICTS.join('|')}`);
      evidence(label, r);
      rows[key].push(r);
    }
  for (const r of list('unplanned')) {
    const label = `unplanned row "${r?.what ?? '(no description)'}"`;
    if (typeof r?.what !== 'string' || !r.what) problems.push(`${label}: needs \`what\``);
    if (!CLASSES.includes(r?.class)) problems.push(`${label}: class must be one of ${CLASSES.join('|')}`);
    evidence(label, r);
    rows.unplanned.push(r);
  }
  return { rows, problems };
}

/** FR-22. A security or privacy NFR that is contradicted or missing is red like any other such row. */
export function computeVerdict(rows: Scorecard): 'green' | 'yellow' | 'red' {
  const scored = [...rows.requirements, ...rows.nfr];
  if (scored.some((r) => r.verdict === 'contradicted' || r.verdict === 'missing') || rows.unplanned.some((u) => u.class === 'non-goal-breach')) return 'red';
  if (scored.some((r) => r.verdict === 'partial') || rows.unplanned.some((u) => u.class !== 'supporting')) return 'yellow';
  return 'green';
}
