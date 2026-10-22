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

/** A follow-up is open until it is resolved or dismissed (closed), grouped into another (merged), declined twice, or older than 60 days (expired). */
export type FollowupStatus = 'open' | 'closed' | 'merged' | 'expired';
export const MAX_DECLINES = 2;
export const MAX_AGE_DAYS = 60;
/** The most open follow-ups a plan may leave behind when it closes. */
export const MAX_OPEN_PER_PLAN = 5;

export interface ListedSuggestion extends Suggestion {
  slug: string;
  key: string;
  open: boolean;
  status: FollowupStatus;
  declined: number;
  hardening: boolean;
}

const isMarker = (x: Suggestion): boolean => !!x.resolves || !!x.declines;

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

/** All suggestions across plans, each with its derived status. */
export function collectSuggestions(ctx: Ctx, at: number = Date.now()): ListedSuggestion[] {
  const states = allStates(ctx);
  const all = states.flatMap((s) => s.suggestions ?? []);
  const closed = new Set(all.map((x) => x.resolves).filter((r): r is string => !!r));
  const merged = new Set(all.flatMap((x) => x.merges ?? []));
  const declines = new Map<string, number>();
  for (const x of all) if (x.declines) declines.set(x.declines, (declines.get(x.declines) ?? 0) + 1);
  return states.flatMap((s) =>
    (s.suggestions ?? []).filter((x) => !isMarker(x)).map((x) => {
      const key = `${s.slug}:${x.id}`;
      const declined = declines.get(key) ?? 0;
      const hardening = x.kind === 'hardening';
      const old = at - Date.parse(x.at) > MAX_AGE_DAYS * 86_400_000;
      // Hardening items never expire: they wait until someone works them.
      const status: FollowupStatus = closed.has(key) ? 'closed' : merged.has(key) ? 'merged' : !hardening && (declined >= MAX_DECLINES || old) ? 'expired' : 'open';
      return { ...x, slug: s.slug, key, open: status === 'open', status, declined, hardening };
    }),
  );
}

/** Open follow-ups across plans; hardening items are counted apart. */
export function openSuggestionCount(ctx: Ctx): number {
  try {
    return collectSuggestions(ctx).filter((x) => x.open && !x.hardening).length;
  } catch {
    return 0;
  }
}

export function openHardeningCount(ctx: Ctx): number {
  try {
    return collectSuggestions(ctx).filter((x) => x.open && x.hardening).length;
  } catch {
    return 0;
  }
}

const USAGE =
  'usage: cairn suggest add --area <a> [--where <glob>]... (--text <t> | --text-file <f>) [--from <f>] [--kind hardening] | list [--open] [--for <glob>]... [--json] | resolve <slug>:<id> [--dismiss] [--note <t>] | merge <key> <key>... --area <a> [--where <glob>]... --text <t> | decline <key>...';

export function cmdSuggest(ctx: Ctx, action: string | undefined, arg: string | undefined, opts: Opts, more: string[] = []): Result {
  if (action === 'add') return suggestAdd(ctx, opts);
  if (action === 'list') return suggestList(ctx, opts);
  if (action === 'resolve') return suggestResolve(ctx, arg, opts);
  if (action === 'merge') return suggestMerge(ctx, [arg, ...more].filter((k): k is string => !!k), opts);
  if (action === 'decline') return suggestDecline(ctx, [arg, ...more].filter((k): k is string => !!k));
  throw new CliError(USAGE);
}

function suggestAdd(ctx: Ctx, opts: Opts): Result {
  const area = String(opts.area ?? '');
  if (!(SUGGESTION_AREAS as readonly string[]).includes(area)) throw new CliError(`--area must be one of ${SUGGESTION_AREAS.join(', ')}`);
  const kind = opts.kind === undefined ? undefined : String(opts.kind);
  if (kind !== undefined && kind !== 'hardening') throw new CliError('--kind must be hardening');
  const from = String(opts.from ?? (kind ? 'mvp' : 'implementer'));
  if (!(SUGGESTION_SOURCES as readonly string[]).includes(from)) throw new CliError(`--from must be one of ${SUGGESTION_SOURCES.join(', ')}`);
  const text = typeof opts.text === 'string' ? opts.text.trim() : '';
  if (!text) throw new CliError('--text or --text-file is required');
  if (kind && !list(opts.where).length) throw new CliError('--kind hardening needs at least one --where glob: the item is found later by path');
  const pc = planCtx(ctx);
  return mutate(pc, undefined, (s) => {
    const all = (s.suggestions ??= []);
    const id = `s${all.length + 1}`;
    all.push({ id, area: area as Suggestion['area'], text, where: list(opts.where), from: from as Suggestion['from'], at: now(), ...(kind ? { kind: 'hardening' as const } : {}) });
    return { message: `${s.slug}:${id}`, data: { id, key: `${s.slug}:${id}` } };
  });
}

function suggestList(ctx: Ctx, opts: Opts): Result {
  const forGlobs = list(opts.for);
  const rows = collectSuggestions(ctx).filter((x) => (!opts.open || x.open) && (!forGlobs.length || (x.where.length > 0 && scopesOverlap(forGlobs, x.where))));
  const lines: string[] = [];
  for (const area of SUGGESTION_AREAS)
    for (const x of rows.filter((r) => r.area === area))
      lines.push(`- [${area}] ${x.text} (${x.key}, noted ${x.at.slice(0, 10)})${x.where.length ? ` — ${x.where.join(', ')}` : ''}${x.open ? '' : ` [${x.status}]`}`);
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

const KEY = /^[a-z0-9-]+:s\d+$/;

/** The listed follow-ups for these keys, all of which must exist and still be open. */
function openTargets(ctx: Ctx, keys: string[]): ListedSuggestion[] {
  if (!keys.length || keys.some((k) => !KEY.test(k))) throw new CliError(USAGE);
  const all = collectSuggestions(ctx);
  return keys.map((k) => {
    const t = all.find((x) => x.key === k);
    if (!t) throw new Refusal(`no suggestion ${k}`, ['cairn suggest list']);
    if (!t.open) throw new Refusal(`${k} is already ${t.status}`);
    return t;
  });
}

function suggestMerge(ctx: Ctx, keys: string[], opts: Opts): Result {
  if (new Set(keys).size < 2) throw new CliError('merge needs at least two different follow-ups');
  const area = String(opts.area ?? '');
  if (!(SUGGESTION_AREAS as readonly string[]).includes(area)) throw new CliError(`--area must be one of ${SUGGESTION_AREAS.join(', ')}`);
  const text = typeof opts.text === 'string' ? opts.text.trim() : '';
  if (!text) throw new CliError('--text or --text-file is required');
  const targets = openTargets(ctx, [...new Set(keys)]);
  const where = list(opts.where).length ? list(opts.where) : [...new Set(targets.flatMap((t) => t.where))];
  const pc = planCtx(ctx);
  return mutate(pc, undefined, (s) => {
    const all = (s.suggestions ??= []);
    const id = `s${all.length + 1}`;
    all.push({ id, area: area as Suggestion['area'], text, where, from: 'plan', at: now(), merges: targets.map((t) => t.key) });
    return { message: `Merged ${targets.length} into ${s.slug}:${id}.`, data: { id, key: `${s.slug}:${id}` } };
  });
}

function suggestDecline(ctx: Ctx, keys: string[]): Result {
  const targets = openTargets(ctx, [...new Set(keys)]);
  const pc = planCtx(ctx);
  return mutate(pc, undefined, (s) => {
    const all = (s.suggestions ??= []);
    for (const t of targets) all.push({ id: `s${all.length + 1}`, area: t.area, text: `Declined ${t.key}`, where: t.where, from: 'user', at: now(), declines: t.key });
    const expired = targets.filter((t) => t.declined + 1 >= MAX_DECLINES);
    return { message: `Declined ${targets.length}.${expired.length ? ` Now expired: ${expired.map((t) => t.key).join(', ')}.` : ''}` };
  });
}
