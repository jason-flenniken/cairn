import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { commonDir } from '../git.ts';
import { PLANS_DIR, type Ctx } from '../locate.ts';
import { sections } from '../sections.ts';
import { parseState } from '../state.ts';
import type { Suggestion } from '../types.ts';
import { readText } from '../util.ts';
import type { Result } from '../shared.ts';
import { listPlans } from './status.ts';
import { collectSuggestions, type FollowupStatus } from './suggest.ts';

export interface RecordEntry {
  slug: string;
  title: string;
  date: string;
  stage: string;
  why: string;
  record?: string;
  followUps: { text: string; area: Suggestion['area']; status: FollowupStatus; hardening?: true }[];
}

const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})-/;

/** First sentence of the record's `## Why` section, on one line. Empty when there is none. */
export function whyLine(md: string | undefined): string {
  const body = (md ? sections(md).get('why') ?? '' : '').replace(/<!--[\s\S]*?-->/g, '').trim();
  const para = body.split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  return para.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? para;
}

/** Every plan, in-progress ones first, then closed ones newest first. Works from any worktree of the repository. */
export function listRecords(ctx: Ctx): RecordEntry[] {
  const main = dirname(commonDir(ctx.top));
  const byMain: Ctx = { ...ctx, top: main };
  const found = new Map<string, { state: ReturnType<typeof parseState>; dir: string }>();
  for (const r of listPlans(ctx)) found.set(r.state.slug, { state: r.state, dir: r.dir });
  const base = join(main, PLANS_DIR);
  if (existsSync(base))
    for (const name of readdirSync(base)) {
      const raw = readText(join(base, name, 'state.json'));
      if (raw === undefined) continue;
      try {
        const state = parseState(raw);
        if (!found.has(state.slug)) found.set(state.slug, { state, dir: join(base, name) });
      } catch {
        // Not a readable plan record.
      }
    }
  const followUps = new Map<string, RecordEntry['followUps']>();
  for (const x of collectSuggestions(byMain)) followUps.set(x.slug, [...(followUps.get(x.slug) ?? []), { text: x.text, area: x.area, status: x.status, ...(x.hardening ? { hardening: true as const } : {}) }]);

  const entries = [...found.values()].map(({ state, dir }): RecordEntry => {
    let recordPath = join(dir, 'RECORD.md');
    // A plan found on its branch may have its record only in the main checkout.
    if (!existsSync(recordPath)) recordPath = join(base, basename(dir), 'RECORD.md');
    const text = readText(recordPath);
    return {
      slug: state.slug,
      title: state.title,
      date: basename(dir).match(DATE_PREFIX)?.[1] ?? state.created.slice(0, 10),
      stage: state.stage,
      why: whyLine(text),
      ...(text !== undefined ? { record: recordPath } : {}),
      followUps: followUps.get(state.slug) ?? [],
    };
  });
  const open = (e: RecordEntry) => (e.stage === 'closed' ? 1 : 0);
  return entries.sort((a, b) => open(a) - open(b) || b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

export function cmdRecords(ctx: Ctx): Result {
  const records = listRecords(ctx);
  const lines = records.map((r) => {
    const open = r.followUps.filter((f) => f.status === 'open').length;
    return [
      `${r.date}  ${r.title} (${r.slug})${r.stage === 'closed' ? '' : `  [in progress: ${r.stage}]`}`,
      ...(r.why ? [`    ${r.why}`] : []),
      ...(r.record ? [`    ${r.record}`] : []),
      ...(r.followUps.length ? [`    ${r.followUps.length} follow-up(s), ${open} open`] : []),
    ].join('\n');
  });
  return { message: lines.length ? lines.join('\n') : 'No plans yet.', data: { records } };
}
