import type { Ctx } from '../locate.ts';
import { log } from '../state.ts';
import { CliError, now, Refusal } from '../util.ts';
import { gate, mutate, planCtx, type Opts, type Result } from '../shared.ts';

export function cmdEvidence(ctx: Ctx, kind: string | undefined, result: string | undefined, opts: Opts): Result {
  if ((kind !== 'verify' && kind !== 'review') || (result !== 'pass' && result !== 'fail'))
    throw new CliError('usage: cairn evidence verify|review pass|fail [--note "…"] [--blocking N]');
  const pc = planCtx(ctx);
  return mutate(pc, `${kind} ${result}`, (s) => {
    gate(s.stage === kind, s, `evidence ${kind}`, opts, `the plan is in ${s.stage}, not ${kind}`);
    const blocking = opts.blocking !== undefined ? Number(opts.blocking) : undefined;
    if (result === 'pass' && blocking) throw new Refusal(`a review with ${blocking} blocking finding(s) can't pass`, ['turn them into fix slices (cairn plan load --replan) or record fail']);
    s.evidence[kind] = { result, at: now(), ...(opts.note ? { note: String(opts.note) } : {}), ...(blocking !== undefined ? { blocking } : {}) };
    log(s, `${kind} ${result}`, opts.note ? String(opts.note) : undefined);
    return { message: `Recorded ${kind}: ${result}.` };
  });
}

export function cmdDriftAck(ctx: Ctx, path: string | undefined, opts: Opts): Result {
  if (!path && !opts.all) throw new CliError('usage: cairn drift ack <path>|--all [--note "…"]');
  const pc = planCtx(ctx);
  return mutate(pc, undefined, (s) => {
    const hits = s.drift.filter((d) => !d.acked && (opts.all || d.path === path));
    if (!hits.length) throw new Refusal(`no unreviewed drift${path ? ` for ${path}` : ''}`);
    for (const d of hits) d.acked = { at: now(), ...(opts.note ? { note: String(opts.note) } : {}) };
    log(s, 'drift reviewed', hits.map((d) => d.path).join(', '));
    return { message: `Marked ${hits.length} drift entr${hits.length === 1 ? 'y' : 'ies'} as reviewed.` };
  });
}
