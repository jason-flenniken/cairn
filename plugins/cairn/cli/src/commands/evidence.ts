import type { Ctx } from '../locate.ts';
import { log } from '../state.ts';
import { CliError, now, readText, Refusal } from '../util.ts';
import { git } from '../git.ts';
import { computeVerdict, parseScorecard } from '../direction.ts';
import { currentPhase } from '../ready.ts';
import { gate, mutate, planCtx, planFile, type Opts, type Result } from '../shared.ts';

function cmdEvidencePhase(ctx: Ctx, opts: Opts): Result {
  const pc = planCtx(ctx);
  return mutate(pc, 'phase direction verdict', (s) => {
    const phase = currentPhase(s);
    if (s.stage !== 'execute' || !phase || phase.status !== 'awaiting_approval') throw new Refusal('no phase is waiting for approval', ['finish the phase\'s tasks first (cairn ready / cairn task done)']);
    const rel = `direction/${phase.id}.md`;
    const md = readText(planFile(pc, rel));
    if (md === undefined) throw new Refusal(`${rel} does not exist`, ['run the direction check and write the report with a cairn-direction scorecard']);
    const { rows, problems } = parseScorecard(md);
    const covered = [...new Set(phase.tasks.flatMap((x) => x.covers))];
    const have = new Set(rows.requirements.map((r) => r?.id));
    const missing = covered.filter((id) => !have.has(id));
    if (missing.length) problems.push(`no row for covered requirement(s): ${missing.join(', ')}`);
    if (problems.length) throw new Refusal(`${rel} is not a valid scorecard:\n  - ${problems.join('\n  - ')}`);
    const result = computeVerdict(rows);
    const commit = git(['rev-parse', 'HEAD'], pc.plan.worktree);
    phase.verdict = { result, at: now(), commit, ...(opts.note ? { note: String(opts.note) } : {}) };
    log(s, `direction ${result}`, phase.name);
    return { message: `Recorded the direction verdict for "${phase.name}": ${result} at ${commit.slice(0, 7)}.`, data: { verdict: result, commit } };
  });
}

export function cmdEvidence(ctx: Ctx, kind: string | undefined, result: string | undefined, opts: Opts): Result {
  if (kind === 'phase') return cmdEvidencePhase(ctx, opts);
  if ((kind !== 'verify' && kind !== 'review') || (result !== 'pass' && result !== 'fail'))
    throw new CliError('usage: cairn evidence verify|review pass|fail [--note "…"] [--blocking N] | evidence phase [--note "…"]');
  const pc = planCtx(ctx);
  return mutate(pc, `${kind} ${result}`, (s) => {
    gate(s.stage === kind, s, `evidence ${kind}`, opts, `the plan is in ${s.stage}, not ${kind}`);
    const blocking = opts.blocking !== undefined ? Number(opts.blocking) : undefined;
    if (result === 'pass' && blocking) throw new Refusal(`a review with ${blocking} blocking finding(s) can't pass`, ['turn them into fix tasks (cairn plan load --replan) or record fail']);
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
