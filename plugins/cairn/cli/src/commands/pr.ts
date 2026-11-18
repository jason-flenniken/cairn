import { spawnSync } from 'node:child_process';
import { git, gitTry } from '../git.ts';
import type { Ctx } from '../locate.ts';
import { allTasks, leftOut, setAside } from '../ready.ts';
import { sections } from '../sections.ts';
import { loadState, log } from '../state.ts';
import type { State } from '../types.ts';
import { CliError, now, readText, Refusal } from '../util.ts';
import { mutate, planCtx, planFile, recordProblems, suiteGreenAtHead, type Opts, type PlanCtx, type Result } from '../shared.ts';
import { fastLane } from './fix.ts';
import { proofProblems } from './prove.ts';
import { prdEditedSinceApproval } from './stages.ts';

/**
 * What the pull request says about a hands-off run. The CLI works it out from what it recorded (test runs, proofs,
 * review evidence, its own ledgers), so the model's words never decide whether the work counts as done.
 */
export interface PrReport {
  done: string[];
  calls: string[];
  notDone: string[];
  /** True when anything is not done: the pull request is opened, or put back, as a draft. */
  draft: boolean;
}

/** Decisions the run made alone (`cairn decide "Assumed: …"`), as `question → answer`. */
function assumed(decisions: string | undefined): string[] {
  const out: string[] = [];
  const re = /^### \d+\. Assumed: (.+)\n\*\*Decision:\*\* (.+)$/gm;
  for (let m = re.exec(decisions ?? ''); m; m = re.exec(decisions ?? '')) out.push(`${m[1].trim()} → ${m[2].trim()}`);
  return out;
}

export function prReport(pc: PlanCtx, s: State): PrReport {
  const tasks = allTasks(s);
  const built = tasks.filter((t) => t.status === 'done');
  const notDone: string[] = [];
  const out = leftOut(s);
  for (const t of out) notDone.push(setAside(t) ? `Task "${t.name}" was set aside${t.note ? `: ${t.note}` : ''}` : `Task "${t.name}" was not started: it waits on a task that was set aside`);
  for (const t of tasks) if (t.status !== 'done' && !out.includes(t)) notDone.push(`Task "${t.name}" is not finished`);
  const proofs = proofProblems(pc, s);
  for (const p of proofs) notDone.push(`Proof: ${p}`);
  const suite = !pc.cfg.test ? 'no test command is configured' : suiteGreenAtHead(pc) ? 'green on this commit' : undefined;
  if (!suite) notDone.push(`The full test suite is not green on this commit${s.lastRed?.failing?.length ? ` (${s.lastRed.failing[0]})` : ''}`);
  const fix = fastLane(s);
  if (!fix && s.evidence.verify?.result !== 'pass') notDone.push('The check stage did not pass');
  const review = s.evidence.review;
  if (review?.result !== 'pass') notDone.push('The review did not pass');
  else if (review.blocking) notDone.push(`${review.blocking} blocking review finding${review.blocking === 1 ? '' : 's'} still open`);
  if (prdEditedSinceApproval(s, readText(planFile(pc, 'prd.md')))) notDone.push('prd.md changed after it was approved, and the edits are not approved');
  for (const n of s.notDone ?? []) notDone.push(`${n.what} — ${n.why}`);

  const total = s.endProofs?.list.filter((p) => !p.retired).length ?? 0;
  const done = [
    `Tasks: ${built.length} of ${tasks.length} merged`,
    `Full test suite: ${suite ?? 'not green'}`,
    ...(total ? [`Proofs: ${proofs.length ? `${proofs.length} problem${proofs.length === 1 ? '' : 's'} (see Not done)` : `all ${total} green`}`] : []),
    `Review: ${review?.result === 'pass' ? `passed${review.blocking ? `, ${review.blocking} blocking open` : ', nothing blocking'}` : 'not passed'}`,
  ];
  const calls = [...(s.calls ?? []).map((c) => `${c.what} — ${c.why}`), ...assumed(readText(planFile(pc, 'decisions.md'))).map((a) => `Assumed: ${a}`)];
  return { done, calls, notDone, draft: notDone.length > 0 };
}

const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x.replace(/\s*\n\s*/g, ' ')}`) : ['- None']);

/** The pull request body: what was built, then Done, Calls made for you, and Not done. */
export function prBody(pc: PlanCtx, s: State): { title: string; body: string; report: PrReport } {
  const r = prReport(pc, s);
  const built = (sections(readText(planFile(pc, 'RECORD.md')) ?? '').get('what was built') ?? '').trim();
  const body = [
    ...(built ? [built, ''] : []),
    '## Done',
    ...list(r.done),
    '',
    `## Calls made for you (${r.calls.length})`,
    ...list(r.calls),
    '',
    `## Not done (${r.notDone.length})`,
    ...list(r.notDone),
    '',
    r.draft ? 'This is a draft because something above is not done. Merge it as it is, or send it back with notes.' : 'Everything the PRD asked for is done and green. Merging is your sign-off.',
    '',
    `Plan: \`${s.slug}\` · record: \`RECORD.md\` in the plan folder`,
  ].join('\n');
  return { title: s.title, body, report: r };
}

const gh = (args: string[], cwd: string) => {
  const r = spawnSync('gh', args, { cwd, encoding: 'utf8', timeout: 60_000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
};

/**
 * `cairn pr body` prints the pull request body. `cairn pr open` pushes the plan branch and opens the pull request, or
 * updates the one that is open: its body and whether it is a draft both come from `prReport`, never from a flag.
 */
export function cmdPr(ctx: Ctx, action: string | undefined, _opts: Opts): Result {
  if (action !== 'body' && action !== 'open') throw new CliError('usage: cairn pr body | cairn pr open');
  const pc = planCtx(ctx);
  const wt = pc.plan.worktree;
  const s0 = loadState(pc.plan.dir);
  const { title, body, report } = prBody(pc, s0);
  if (action === 'body') return { message: body, data: { title, body, ...report } };

  if (!['ship', 'learn', 'closed'].includes(s0.stage)) throw new Refusal(`the pull request opens at ship; the plan is in ${s0.stage}`, ['cairn next']);
  const record = fastLane(s0) ? [] : recordProblems(pc);
  if (record.length) throw new Refusal(record.join('; '), ['write RECORD.md from templates/record.md']);
  const pushed = gitTry(['push', '-u', 'origin', s0.branch], wt);
  if (!pushed.ok) throw new Refusal(`could not push ${s0.branch}: ${pushed.out}`, ['check the remote and credentials, then run cairn pr open again']);
  const head = git(['rev-parse', 'HEAD'], wt);
  const seen = gh(['pr', 'view', s0.branch, '--json', 'url,isDraft,state', '-q', '[.url, (.isDraft|tostring), .state] | join(" ")'], wt);
  const [seenUrl, seenDraft, seenState] = seen.ok ? seen.out.split(' ') : [];
  let url = seenUrl;
  if (seen.ok && seenState === 'OPEN') {
    const edited = gh(['pr', 'edit', s0.branch, '--title', title, '--body', body], wt);
    if (!edited.ok) throw new Refusal(`could not update the pull request: ${edited.out}`);
    if (String(report.draft) !== seenDraft) {
      const flipped = gh(['pr', 'ready', s0.branch, ...(report.draft ? ['--undo'] : [])], wt);
      if (!flipped.ok) throw new Refusal(`could not mark the pull request ${report.draft ? 'as a draft' : 'ready'}: ${flipped.out}`);
    }
  } else {
    const made = gh(['pr', 'create', '--base', s0.base, '--head', s0.branch, '--title', title, '--body', body, ...(report.draft ? ['--draft'] : [])], wt);
    if (!made.ok) throw new Refusal(`could not open the pull request: ${made.out}`, ['check that gh is installed and signed in (gh auth status), then run cairn pr open again']);
    url = made.out.split('\n').filter((l) => /^https?:\/\//.test(l)).pop() ?? made.out;
  }
  return mutate(pc, 'pull request opened', (s) => {
    s.pullRequest = { url: url as string, draft: report.draft, at: now(), head };
    log(s, s0.pullRequest ? 'pull request updated' : 'pull request opened', `${report.draft ? 'draft' : 'ready'}: ${url}`);
    const state = report.draft ? `a draft: ${report.notDone.length} not done` : 'ready to merge';
    return {
      message: `Pull request ${s0.pullRequest ? 'updated' : 'opened'} (${state}): ${url}\nThe user merging it is the sign-off. Next: cairn advance, then end the turn.`,
      data: { url, head, ...report },
    };
  });
}
