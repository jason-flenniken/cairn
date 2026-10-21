import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { scopesOverlap } from '../glob.ts';
import { PLANS_DIR, type Ctx } from '../locate.ts';
import { parseState } from '../state.ts';
import { SUGGESTION_AREAS, SUGGESTION_SOURCES, type State, type Suggestion } from '../types.ts';
import { CliError, now, readText, Refusal } from '../util.ts';
import { mutate, planCtx, type Opts, type Result } from '../shared.ts';
import { listPlans } from './status.ts';

const list = (v: unknown): string[] => (typeof v === 'string' ? v.split('\n').filter(Boolean) : []);

export interface ListedSuggestion extends Suggestion {
  slug: string;
  key: string;
  open: boolean;
}

/** Every plan's state: branches and worktrees first, then closed plans in this checkout. Deduped by slug. */
function allStates(ctx: Ctx): State[] {
  const out = new Map<string, State>();
  for (const r of listPlans(ctx)) out.set(r.state.slug, r.state);
  const dir = join(ctx.top, PLANS_DIR);
  if (existsSync(dir))
    for (const name of readdirSync(dir)) {
      const raw = readText(join(dir, name, 'state.json'));
      if (raw === undefined) continue;
      try {
        const s = parseState(raw);
        if (!out.has(s.slug)) out.set(s.slug, s);
      } catch {
        // Not a readable plan record.
      }
    }
  return [...out.values()];
}

/** All suggestions across plans, each marked open or closed. */
export function collectSuggestions(ctx: Ctx): ListedSuggestion[] {
  const states = allStates(ctx);
  const closed = new Set(states.flatMap((s) => (s.suggestions ?? []).map((x) => x.resolves).filter((r): r is string => !!r)));
  return states.flatMap((s) =>
    (s.suggestions ?? []).filter((x) => !x.resolves).map((x) => ({ ...x, slug: s.slug, key: `${s.slug}:${x.id}`, open: !closed.has(`${s.slug}:${x.id}`) })),
  );
}

export function openSuggestionCount(ctx: Ctx): number {
  try {
    return collectSuggestions(ctx).filter((x) => x.open).length;
  } catch {
    return 0;
  }
}

const USAGE =
  'usage: cairn suggest add --area <a> [--where <glob>]... (--text <t> | --text-file <f>) [--from <f>] | list [--open] [--for <glob>]... [--json] | resolve <slug>:<id> [--dismiss] [--note <t>]';

export function cmdSuggest(ctx: Ctx, action: string | undefined, arg: string | undefined, opts: Opts): Result {
  if (action === 'add') return suggestAdd(ctx, opts);
  if (action === 'list') return suggestList(ctx, opts);
  if (action === 'resolve') return suggestResolve(ctx, arg, opts);
  throw new CliError(USAGE);
}

function suggestAdd(ctx: Ctx, opts: Opts): Result {
  const area = String(opts.area ?? '');
  if (!(SUGGESTION_AREAS as readonly string[]).includes(area)) throw new CliError(`--area must be one of ${SUGGESTION_AREAS.join(', ')}`);
  const from = String(opts.from ?? 'implementer');
  if (!(SUGGESTION_SOURCES as readonly string[]).includes(from)) throw new CliError(`--from must be one of ${SUGGESTION_SOURCES.join(', ')}`);
  const text = typeof opts.text === 'string' ? opts.text.trim() : '';
  if (!text) throw new CliError('--text or --text-file is required');
  const pc = planCtx(ctx);
  return mutate(pc, undefined, (s) => {
    const all = (s.suggestions ??= []);
    const id = `s${all.length + 1}`;
    all.push({ id, area: area as Suggestion['area'], text, where: list(opts.where), from: from as Suggestion['from'], at: now() });
    return { message: `${s.slug}:${id}`, data: { id, key: `${s.slug}:${id}` } };
  });
}

function suggestList(ctx: Ctx, opts: Opts): Result {
  const forGlobs = list(opts.for);
  const rows = collectSuggestions(ctx).filter((x) => (!opts.open || x.open) && (!forGlobs.length || (x.where.length > 0 && scopesOverlap(forGlobs, x.where))));
  const lines: string[] = [];
  for (const area of SUGGESTION_AREAS)
    for (const x of rows.filter((r) => r.area === area))
      lines.push(`- [${area}] ${x.text} (${x.key}, noted ${x.at.slice(0, 10)})${x.where.length ? ` — ${x.where.join(', ')}` : ''}${x.open ? '' : ' [closed]'}`);
  return {
    message: lines.length ? lines.join('\n') : opts.open ? 'No open suggestions.' : 'No suggestions.',
    data: { suggestions: rows, open: rows.filter((x) => x.open).length },
  };
}

function suggestResolve(ctx: Ctx, key: string | undefined, opts: Opts): Result {
  if (!key || !/^[a-z0-9-]+:s\d+$/.test(key)) throw new CliError(USAGE);
  const target = collectSuggestions(ctx).find((x) => x.key === key);
  if (!target) throw new Refusal(`no suggestion ${key}`, ['cairn suggest list']);
  const pc = planCtx(ctx);
  return mutate(pc, undefined, (s) => {
    const all = (s.suggestions ??= []);
    all.push({
      id: `s${all.length + 1}`,
      area: target.area,
      text: `${opts.dismiss ? 'Dismissed' : 'Resolved'} ${key}`,
      where: target.where,
      from: 'user',
      at: now(),
      resolves: key,
      ...(opts.dismiss ? { dismissed: true } : {}),
      ...(opts.note ? { note: String(opts.note) } : {}),
    });
    return { message: `${opts.dismiss ? 'Dismissed' : 'Resolved'} ${key}.` };
  });
}
