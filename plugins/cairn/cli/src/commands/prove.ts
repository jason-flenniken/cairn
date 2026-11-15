import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { filesHash, isDue, prdIds, proofsActive, proofsRequired, tasksFor } from '../endproofs.ts';
import { commonDir, git, gitOk, topLevel } from '../git.ts';
import { planRelOf, type Ctx } from '../locate.ts';
import { allTasks, findTask } from '../ready.ts';
import { loadState, log } from '../state.ts';
import type { EndProof, ProofRun, State } from '../types.ts';
import { CliError, hashText, now, readText, Refusal } from '../util.ts';
import { mutate, planCtx, planFile, runSuite, type Opts, type PlanCtx, type Result } from '../shared.ts';
import { changesSince } from './merge.ts';

const USAGE = 'usage: cairn prove [<id>...] [--task <id>] [--here] | prove list [--json] | prove judge <id> pass|fail [--note "…"] | prove add <id> --covers FR-01[,FR-02] --run "<cmd>" --files a[,b] [--shots x,y --look "…"] [--note "why"]';

export type ProofState = 'green' | 'red' | 'not run' | 'stale' | 'changed' | 'unjudged' | 'judged fail';

/** Where a proof's run writes its log and screenshots: under the git common dir, never committed. */
const runDir = (wt: string, slug: string, id: string, here = false): string => join(commonDir(wt), 'cairn', 'proofs', slug, here ? `here-${id}` : id);

const csv = (v: unknown): string[] => (typeof v === 'string' ? v.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean) : []);

/** Where one proof stands on the plan branch now, and why. */
export function proofState(p: EndProof, wt: string, planRel: string, baseMerges: readonly string[]): { state: ProofState; why: string } {
  const current = filesHash(wt, p.files);
  if (p.lock && current !== p.lock) return { state: 'changed', why: `its files changed since they were locked (${p.files.join(', ')})` };
  const r = p.last;
  if (!r) return { state: 'not run', why: 'it has not run' };
  if (r.files !== current) return { state: 'stale', why: 'its files changed since it ran' };
  if (r.result === 'fail') return { state: 'red', why: r.tail };
  if (!r.head) return { state: 'stale', why: 'its run belongs to no single commit (the checkout moved)' };
  const since = changesSince(wt, r.head, planRel, baseMerges);
  if (since.length) return { state: 'stale', why: `the code changed since it ran: ${since.join('; ')}` };
  if (p.shots?.length && !r.judged) return { state: 'unjudged', why: 'its screenshots have no verdict' };
  if (r.judged?.result === 'fail') return { state: 'judged fail', why: `the screenshots were judged wrong${r.judged.note ? `: ${r.judged.note}` : ''}` };
  return { state: 'green', why: '' };
}

/** Why the plan's proofs do not yet show the end state; empty when every proof is green on the current code. */
export function proofProblems(pc: PlanCtx, s: State): string[] {
  if (!proofsActive(s)) return [];
  const list = s.endProofs?.list ?? [];
  if (!list.length) return ['no proofs are loaded'];
  const rel = planRelOf(pc.plan);
  return list.flatMap((p) => {
    const st = proofState(p, pc.plan.worktree, rel, s.baseMerges ?? []);
    return st.state === 'green' ? [] : [`${p.id} is ${st.state}: ${st.why}`];
  });
}

/** One line for the ship card: what the proofs showed. */
export function proofSummary(s: State): string | undefined {
  const ep = s.endProofs;
  if (!ep?.list.length) return undefined;
  const shots = ep.list.filter((p) => p.shots?.length && p.last?.judged?.result === 'pass');
  const added = ep.list.filter((p) => p.added);
  return [
    `**Proofs:** ${ep.list.length} green on the shipped code`,
    shots.length ? `, screenshots judged for ${shots.map((p) => `${p.id} (${p.last?.shotsDir})`).join(', ')}` : '',
    added.length ? `; added during the build: ${added.map((p) => `${p.id} (${p.covers.join(', ')})${p.added?.note ? ` — ${p.added.note}` : ''}`).join('; ')}` : '',
    ep.notProvable.length ? `; not provable by a run: ${ep.notProvable.map((n) => n.id).join(', ')}` : '',
    '.',
  ].join('');
}

/** The checks the plan approval adds when proofs are in play: loaded, unchanged, and each new proof seen failing. */
export function proofApprovalProblems(pc: PlanCtx, s: State): string[] {
  if (!proofsActive(s)) return [];
  const ep = s.endProofs;
  if (!ep?.list.length) return ['no proofs are loaded: write proofs.md with the proof-writer, then cairn plan load'];
  const md = readText(planFile(pc, 'proofs.md'));
  if (!md || ep.hash !== hashText(md)) return ['proofs.md changed since it was loaded: cairn plan load'];
  const out: string[] = [];
  // Task worktrees branch from the committed plan branch: a proof file that is untracked or edited would not reach them.
  const files = [...new Set(ep.list.flatMap((p) => p.files))];
  const untracked = files.filter((f) => !gitOk(['ls-files', '--error-unmatch', '--', f], pc.plan.worktree));
  const dirty = files.length ? git(['diff', '--name-only', 'HEAD', '--', ...files], pc.plan.worktree).split('\n').filter(Boolean) : [];
  const loose = [...new Set([...untracked, ...dirty])];
  if (loose.length) out.push(`proof files are not committed on the plan branch: ${loose.join(', ')} (commit them, then run cairn prove again)`);
  for (const p of ep.list) {
    if (p.lock) continue; // Locked before a re-plan: its code may already be built, so it can't be red now.
    const h = filesHash(pc.plan.worktree, p.files);
    if (p.expect === 'pass') {
      if (p.last?.result !== 'pass' || p.last.files !== h) out.push(`guard proof ${p.id} has not been seen passing: cairn prove ${p.id}`);
    } else if (p.seenRed !== h) out.push(`proof ${p.id} has not been seen failing: cairn prove ${p.id} (a proof that passes before the build proves nothing; mark a guard with expect: pass)`);
  }
  return out;
}

function hashShots(dir: string, names: string[]): string | undefined {
  if (!names.length) return undefined;
  const h = createHash('sha256');
  for (const n of names) {
    const f = join(dir, `${n}.png`);
    h.update(existsSync(f) ? readFileSync(f) : '<missing>');
  }
  return h.digest('hex').slice(0, 16);
}

function runOne(pc: PlanCtx, s: State, p: EndProof, cwd: string, here: boolean): ProofRun {
  const dir = runDir(pc.plan.worktree, s.slug, p.id, here);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const r = runSuite(p.run, pc.cfg, cwd, { CAIRN_SHOTS: dir, CAIRN_PROOF: p.id });
  const logPath = join(dir, 'run.log');
  writeFileSync(logPath, r.output ?? '');
  const missing = (p.shots ?? []).filter((n) => !existsSync(join(dir, `${n}.png`)));
  const ok = r.ok && r.ran && !missing.length;
  const tail = missing.length && r.ok ? `missing screenshots in $CAIRN_SHOTS: ${missing.map((n) => `${n}.png`).join(', ')}` : r.tail;
  return {
    result: ok ? 'pass' : 'fail',
    at: now(),
    ...(r.head ? { head: r.head } : {}),
    tail,
    log: logPath,
    files: filesHash(cwd, p.files),
    ...(p.shots?.length ? { shotsDir: dir, shots: hashShots(dir, p.shots) } : {}),
  };
}

function cmdRun(pc: PlanCtx, ctx: Ctx, pos: string[], opts: Opts): Result {
  const s0 = loadState(pc.plan.dir);
  const list = s0.endProofs?.list ?? [];
  if (!list.length) throw new Refusal('this plan has no proofs loaded', ['write proofs.md (the proof-writer agent), then cairn plan load']);
  let pick = list;
  if (pos.length) {
    const unknown = pos.filter((id) => !list.some((p) => p.id === id));
    if (unknown.length) throw new Refusal(`no proof ${unknown.join(', ')} in this plan`, ['cairn prove list']);
    pick = list.filter((p) => pos.includes(p.id));
  }
  const tasks = allTasks(s0);
  if (typeof opts.task === 'string') {
    const t = findTask(s0, opts.task);
    if (!t) throw new Refusal(`no task "${opts.task}" in this plan`);
    pick = pick.filter((p) => t.covers.some((c) => p.covers.includes(c)));
    if (!pick.length) return { message: `No proof covers what task "${t.name}" builds.` };
  }
  const here = !!opts.here;
  const cwd = here ? topLevel(ctx.cwd) : pc.plan.worktree;
  const runs = pick.map((p) => ({ p, r: runOne(pc, s0, p, cwd, here) }));
  if (!here)
    mutate(pc, 'proofs ran', (s) => {
      for (const { p, r } of runs) {
        const sp = s.endProofs?.list.find((x) => x.id === p.id);
        if (!sp) continue;
        sp.last = r;
        if (r.result === 'fail') sp.seenRed = r.files;
      }
      log(s, 'proofs ran', runs.map(({ p, r }) => `${p.id} ${r.result}`).join(', '));
    });
  const green = runs.filter((x) => x.r.result === 'pass').length;
  const lines = runs.map(({ p, r }) => {
    const waits = r.result === 'fail' && !isDue(p, tasks) ? ` (expected for now: waits on ${tasksFor(p, tasks).filter((t) => t.status !== 'done').map((t) => t.id).join(', ')})` : '';
    const base = `  ${p.id}  ${r.result === 'pass' ? 'pass' : 'FAIL'}  (${p.covers.join(', ')})`;
    if (r.result === 'fail') return `${base}: ${r.tail}${waits}. Full output: ${r.log}`;
    return p.shots?.length ? `${base}. Screenshots: ${r.shotsDir}; judge them against: ${p.look}` : base;
  });
  const where = here ? ` in ${cwd} (not recorded)` : '';
  return {
    message: [`Proofs${where}: ${green} of ${runs.length} pass.`, ...lines].join('\n'),
    data: { here, results: runs.map(({ p, r }) => ({ id: p.id, covers: p.covers, result: r.result, tail: r.tail, log: r.log, shotsDir: r.shotsDir ?? null, look: p.look ?? null })) },
  };
}

function cmdList(pc: PlanCtx): Result {
  const s = loadState(pc.plan.dir);
  const ep = s.endProofs;
  if (!ep?.list.length) return { message: proofsRequired(s) ? 'No proofs loaded yet. This plan needs them before the plan approval.' : 'This plan has no proofs.', data: { proofs: [] } };
  const rel = planRelOf(pc.plan);
  const tasks = allTasks(s);
  const rows = ep.list.map((p) => {
    const st = proofState(p, pc.plan.worktree, rel, s.baseMerges ?? []);
    return { id: p.id, covers: p.covers, state: st.state, why: st.why, due: isDue(p, tasks), locked: !!p.lock, added: !!p.added, shots: p.shots ?? [], look: p.look ?? null, run: p.run, files: p.files };
  });
  const green = rows.filter((r) => r.state === 'green').length;
  return {
    message: [
      `Proofs: ${green} of ${rows.length} green.`,
      ...rows.map((r) => `  ${r.id}  ${r.state}${r.why ? `: ${r.why}` : ''}  (${r.covers.join(', ')}${r.due ? '' : ', not due yet'}${r.added ? ', added in build' : ''})`),
      ...(ep.notProvable.length ? [`Not provable by a run: ${ep.notProvable.map((n) => `${n.id} (${n.reason})`).join('; ')}`] : []),
    ].join('\n'),
    data: { proofs: rows, notProvable: ep.notProvable },
  };
}

function cmdJudge(pc: PlanCtx, id: string | undefined, verdict: string | undefined, opts: Opts): Result {
  if (!id || (verdict !== 'pass' && verdict !== 'fail')) throw new CliError('usage: cairn prove judge <id> pass|fail [--note "…"]');
  return mutate(pc, `proof ${id} judged`, (s) => {
    const p = s.endProofs?.list.find((x) => x.id === id);
    if (!p) throw new Refusal(`no proof ${id} in this plan`, ['cairn prove list']);
    if (!p.shots?.length) throw new Refusal(`proof ${id} takes no screenshots, so there is nothing to judge`);
    if (!p.last || p.last.result !== 'pass') throw new Refusal(`proof ${id} has no passing run to judge`, [`cairn prove ${id}`]);
    p.last.judged = { result: verdict, at: now(), ...(opts.note ? { note: String(opts.note) } : {}) };
    log(s, 'proof judged', `${id} ${verdict}${opts.note ? `: ${opts.note}` : ''}`);
    return { message: `Proof ${id}: screenshots judged ${verdict}.${verdict === 'fail' ? ' Fix the build until the screenshots match, then run it again.' : ''}` };
  });
}

function cmdAdd(pc: PlanCtx, id: string | undefined, opts: Opts): Result {
  if (!id) throw new CliError(USAGE);
  const covers = csv(opts.covers);
  const files = csv(opts.files);
  const shots = csv(opts.shots);
  const run = typeof opts.run === 'string' ? opts.run.trim() : '';
  if (!covers.length || !files.length || !run) throw new CliError(USAGE);
  const reqs = new Set(prdIds(readText(planFile(pc, 'prd.md')) ?? ''));
  return mutate(pc, `proof ${id} added`, (s) => {
    if (!s.approvals.plan || !['execute', 'verify', 'review'].includes(s.stage)) throw new Refusal(`proofs are added during the build; the plan is in ${s.stage}`, ['before the plan approval, add it to proofs.md and run cairn plan load']);
    const ep = (s.endProofs ??= { list: [], notProvable: [] });
    if (ep.list.some((p) => p.id === id)) throw new Refusal(`proof ${id} exists, and proofs are add-only: pick a new id`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Refusal('the proof id must be kebab-case');
    const bad = covers.filter((c) => !reqs.has(c));
    if (bad.length) throw new Refusal(`${bad.join(', ')} is not a requirement in prd.md`);
    const gone = files.filter((f) => !existsSync(join(pc.plan.worktree, f)));
    if (gone.length) throw new Refusal(`${gone.join(', ')} is not on the plan branch yet`, ['merge the task that wrote it first']);
    if (shots.length && typeof opts.look !== 'string') throw new Refusal('a proof with --shots needs --look "<what the screenshots must show>"');
    ep.list.push({
      id,
      covers,
      run,
      files,
      ...(shots.length ? { shots, look: String(opts.look) } : {}),
      added: { at: now(), ...(opts.note ? { note: String(opts.note) } : {}) },
      lock: filesHash(pc.plan.worktree, files),
    });
    log(s, 'proof added', `${id} (${covers.join(', ')})${opts.note ? `: ${opts.note}` : ''}`);
    return { message: `Added proof ${id}, locked. Run it: cairn prove ${id}. It is listed at ship.` };
  });
}

export function cmdProve(ctx: Ctx, pos: string[], opts: Opts): Result {
  const pc = planCtx(ctx);
  const [sub, a, b] = pos;
  if (sub === 'list') return cmdList(pc);
  if (sub === 'judge') return cmdJudge(pc, a, b, opts);
  if (sub === 'add') return cmdAdd(pc, a, opts);
  if (sub === 'help') throw new CliError(USAGE);
  return cmdRun(pc, ctx, pos, opts);
}
