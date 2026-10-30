import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { branchExists, CLOSE_PUBLISHED, currentBranch, git, gitOk, gitTry, safeRef } from '../git.ts';
import { planRelIn, planRelOf, plansDirsIn, type Ctx } from '../locate.ts';
import { loadState, log } from '../state.ts';
import { mutate, planCtx, runTests, type Opts, type Result } from '../shared.ts';
import { now, pluginRoot, readText, Refusal } from '../util.ts';
import { refreshMemory } from './memory.ts';

const short = (sha: string) => sha.slice(0, 7);

/** The fixes a refusal names when the ship needs the user's approval again. */
const reapproveFixes = (slug: string, worktree: string) => [
  `the user approves the ship again in the approval menu tagged [cairn:approve ship ${slug}], or presses Approve in the cairn pane`,
  `or the user runs, in their own terminal: cd ${worktree} && ${pluginRoot()}/bin/cairn approve ship --human`,
  'then run cairn merge-check again',
];

/** A close writes these outside the plan folder, so a conflict in them is cairn's to settle. */
const isPublished = (f: string) => CLOSE_PUBLISHED.some((p) => f === p || f.startsWith(`${p}/`));

/**
 * Why the branch is no longer what was approved (or tested) at `sha`: a commit since then that touches anything but
 * the plan folder, the files a close writes, or `REVIEW.md` (rules the user ticked at ship), or a merge not in
 * `vouched` (the merges cairn made itself). Empty when nothing changed that `sha` does not cover.
 */
export function changesSince(cwd: string, sha: string, planRel: string, vouched: readonly string[]): string[] {
  if (!gitOk(['merge-base', '--is-ancestor', sha, 'HEAD'], cwd)) return [`commit ${short(sha)} is no longer in the branch's history`];
  const exempt = (f: string) => f === 'REVIEW.md' || f === planRel || f.startsWith(`${planRel}/`) || isPublished(f);
  const reasons: string[] = [];
  const files = new Set<string>();
  for (const c of git(['rev-list', '--first-parent', `${sha}..HEAD`], cwd).split('\n').filter(Boolean)) {
    const parents = git(['rev-list', '--parents', '-n', '1', c], cwd).split(' ').slice(1);
    if (parents.length > 1) {
      if (vouched.includes(c)) continue;
      const touched = git(['diff', '--name-only', parents[0], c], cwd).split('\n').filter((f) => f && !exempt(f));
      if (touched.length) reasons.push(`merge ${short(c)}, which cairn did not make, changed ${touched.length} file${touched.length === 1 ? '' : 's'}`);
      continue;
    }
    for (const f of git(['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', c], cwd).split('\n')) if (f && !exempt(f)) files.add(f);
  }
  if (files.size) reasons.push(`commits changed ${[...files].slice(0, 5).join(', ')}${files.size > 5 ? ` and ${files.size - 5} more` : ''}`);
  return reasons;
}

/**
 * Merges `baseRef` into the plan branch. A conflict only in files a close writes (OVERVIEW.md) is settled here: the
 * base's side, then the changelog regenerated from the checkout, as a close would. Any other conflict aborts the
 * merge and returns the conflicted files.
 */
function mergeBase(pc: ReturnType<typeof planCtx>, baseRef: string, message: string): { ok: true } | { ok: false; conflicted: string[]; out: string } {
  const wt = pc.plan.worktree;
  const m = gitTry(['merge', '--no-ff', '--no-edit', '-q', '-m', message, baseRef], wt);
  if (m.ok) return { ok: true };
  const conflicted = gitTry(['diff', '--name-only', '--diff-filter=U'], wt).out.split('\n').filter(Boolean);
  if (conflicted.length && conflicted.every(isPublished)) {
    const settled =
      conflicted.every((f) => gitTry(['checkout', '--theirs', '--', f], wt).ok) &&
      (refreshMemory(wt, pc.ctx), gitTry(['add', '--', ...conflicted], wt).ok) &&
      gitTry(['commit', '-q', '--no-edit'], wt).ok;
    if (settled) return { ok: true };
  }
  gitTry(['merge', '--abort'], wt);
  return { ok: false, conflicted, out: m.out };
}

/**
 * `cairn merge-check`: run right before merging the plan's pull request. Refuses when code changed after the ship
 * approval (and clears it, so the user approves again), merges the base in when it moved (refusing on a conflict,
 * with the merge aborted), and runs the tests until a head passes. Prints the HEAD it checked.
 */
export function cmdMergeCheck(ctx: Ctx, _opts: Opts): Result {
  const pc = planCtx(ctx);
  const wt = pc.plan.worktree;
  const rel = planRelOf(pc.plan);
  const s0 = loadState(pc.plan.dir);
  if (!['ship', 'learn', 'closed'].includes(s0.stage)) throw new Refusal(`merge-check runs after the ship approval; the plan is in ${s0.stage}`);
  if (s0.reapprove) throw new Refusal(`the ship needs approving again: ${s0.reapprove.why}`, reapproveFixes(s0.slug, wt));
  if (!s0.approvals.ship) throw new Refusal('shipping is not approved', ['cairn approve ship']);
  if (!safeRef(wt, s0.base)) throw new Refusal(`the plan's base "${s0.base}" is not a valid branch name`);
  if (currentBranch(wt) !== s0.branch) throw new Refusal(`the plan worktree is on ${currentBranch(wt)}, not the plan branch ${s0.branch}`);
  const dirty = git(['status', '--porcelain'], wt).split('\n').filter((l) => l && !l.slice(3).startsWith(`${rel}/`));
  if (dirty.length) throw new Refusal(`the plan worktree has uncommitted changes: ${dirty.map((l) => l.slice(3)).join(', ')}`, ['commit or remove them, then run cairn merge-check again']);

  const notes: string[] = [];
  // Checking against a stale origin is the failure this command exists to prevent, so a failed fetch refuses.
  // The explicit refspec updates origin/<base> even in a single-branch clone.
  let baseRef = s0.base;
  if (gitOk(['remote', 'get-url', 'origin'], wt)) {
    const fetched = gitTry(['fetch', '-q', 'origin', `+refs/heads/${s0.base}:refs/remotes/origin/${s0.base}`], wt);
    if (!fetched.ok) throw new Refusal(`could not fetch origin/${s0.base}, so it may have moved unseen: ${fetched.out}`, ['check the network or credentials, then run cairn merge-check again']);
    baseRef = `origin/${s0.base}`;
  } else notes.push(`No origin remote: checked against the local ${s0.base}.`);
  if (gitOk(['merge-base', '--is-ancestor', 'HEAD', baseRef], wt)) throw new Refusal(`${s0.branch} is already in ${baseRef}: the pull request has been merged`);

  const approved = s0.approvals.ship.sha;
  if (approved) {
    const reasons = changesSince(wt, approved, rel, s0.baseMerges ?? []);
    if (reasons.length) {
      const why = `code changed after you approved shipping (${reasons.join('; ')})`;
      mutate(pc, 'ship needs approving again', (s) => {
        delete s.approvals.ship;
        s.reapprove = { at: now(), why };
        log(s, 'ship approval cleared', why);
      });
      throw new Refusal(`the ship needs approving again: ${why}`, reapproveFixes(s0.slug, wt));
    }
  } else notes.push('This plan was approved before cairn pinned approvals to a commit, so changes since then were not checked.');

  let merged: { sha: string; behind: number } | undefined;
  if (!gitOk(['merge-base', '--is-ancestor', baseRef, 'HEAD'], wt)) {
    const behind = Number(git(['rev-list', '--count', `HEAD..${baseRef}`], wt));
    const m = mergeBase(pc, baseRef, `Merge ${s0.base} into ${s0.branch} before merging`);
    if (!m.ok)
      throw new Refusal(
        `${s0.base} has ${behind} new commit${behind === 1 ? '' : 's'} that conflict with this branch${m.conflicted.length ? ` in ${m.conflicted.join(', ')}` : `: ${m.out}`}. The merge was aborted; nothing changed.`,
        [`merge ${s0.base} into ${s0.branch} in the plan worktree, resolve the conflicts, and run the tests`, 'then run cairn merge-check again: a merge resolved by hand is new code, so it asks for the ship approval again'],
      );
    merged = { sha: git(['rev-parse', 'HEAD'], wt), behind };
    mutate(pc, `merge ${s0.base} before merging`, (s) => {
      (s.baseMerges ??= []).push((merged as { sha: string }).sha);
      log(s, 'base merged', `${s0.base}: ${behind} new commit${behind === 1 ? '' : 's'}, merged cleanly`);
    });
  }

  // The tests run until a head passes: only plan-folder commits since the last green head skip them.
  const lastGreen = s0.mergeChecked;
  const untested = !lastGreen || changesSince(wt, lastGreen, rel, []).length > 0;
  const tests = untested ? runTests(pc.cfg, wt) : undefined;
  if (tests && !tests.ok) {
    mutate(pc, 'tests fail at merge check', (s) => log(s, 'merge check failed', `${tests.cmd}: ${tests.tail}`));
    throw new Refusal(`tests fail${merged ? ` with ${s0.base} merged in` : ''}: ${tests.tail}`, [
      merged ? 'fix it on the plan branch (the clean merge stays)' : 'fix it on the plan branch',
      'then run cairn merge-check again: the fix is new code, so it asks for the ship approval again',
    ]);
  }
  if (untested && !tests) notes.push('No test command is configured, so the branch was not tested.');
  const tested = git(['rev-parse', 'HEAD'], wt);
  mutate(pc, 'merge checked', (s) => {
    if (tests?.ok) s.mergeChecked = tested;
    log(s, 'merge checked', `${merged ? `${s0.base} merged` : `up to date with ${s0.base}`}${tests ? ', tests pass' : ''}`);
  });
  const head = git(['rev-parse', 'HEAD'], wt);
  const said = merged ? `${s0.base} had moved ${merged.behind} commit${merged.behind === 1 ? '' : 's'}: merged it in cleanly.` : `Up to date with ${s0.base}.`;
  const testSaid = tests ? ` The tests pass (${tests.tail}).` : !untested ? ' Tests passed on this code at the last check.' : '';
  const pinned = approved ? ' Nothing changed since the ship approval that it does not cover.' : '';
  return {
    message: [`${said}${testSaid}${pinned}`, ...notes, `Checked ${head}. Push the plan branch, then merge with: gh pr merge <PR> --merge --match-head-commit ${head}`].join('\n'),
    data: { head, base: baseRef, merged: !!merged, behind: merged?.behind ?? 0, tests: tests ? tests.tail : null, notes },
  };
}

const PR_MERGE = /^Merge pull request #(\d+) from [^/\s]+\/(\S+)/;
const PLAN_BRANCH = /^(?:feature|fix|sdlc)\/(\S+)$/;
const BRANCH_MERGE = /^Merge branch '(?:feature|fix|sdlc)\/([^']+)'/;
const SQUASH = /\(#(\d+)\)$/;
const TASK_MERGE = /^merge task (\S+)/;

interface Traced {
  sha: string;
  date: string;
  subject: string;
  landed?: string;
  pr?: number;
  plan?: string;
  record?: string;
  task?: string;
}

/** The plan folder whose RECORD.md links to pull request `pr`, for a squash merge that kept no branch name. */
function planByPr(root: string, pr: number): string | undefined {
  for (const dir of plansDirsIn(root))
    for (const name of readdirSync(dir))
      if (new RegExp(`^- PR: \\S*/pull/${pr}(?!\\d)`, 'm').test(readText(join(dir, name, 'RECORD.md')) ?? '')) return relative(root, join(dir, name));
  return undefined;
}

/** `cairn trace <path>:<start>[-<end>]`: which commit, merge, plan and task brought these lines (as numbered on the base) into the base. Read-only. */
export function cmdTrace(ctx: Ctx, spec: string | undefined, opts: Opts): Result {
  const m = spec?.match(/^(.+):(\d+)(?:-(\d+))?$/);
  if (!m) throw new Refusal('usage: cairn trace <path>:<start>[-<end>] [--base <branch>]');
  const [, path, start, end = start] = m;
  const root = ctx.top;
  const base = typeof opts.base === 'string' ? opts.base : ctx.plan?.dir ? loadState(ctx.plan.dir).base : 'main';
  if (!safeRef(root, base)) throw new Refusal(`"${base}" is not a valid branch name`);
  // The lines being traced came from local history, so the local base is the line they landed on; origin is the fallback.
  const baseRef = branchExists(base, root) ? base : `origin/${base}`;
  // Blamed as the lines stand where this checkout forked from the base: in a fix plan HEAD already holds the fix, and
  // the old side of `git diff <base>...HEAD` (that fork point) is what broke. On the base itself it is the base.
  const at = gitTry(['merge-base', baseRef, 'HEAD'], root);
  const blame = gitTry(['blame', '--porcelain', '-L', `${start},${end}`, at.ok ? at.out : baseRef, '--', path], root);
  if (!blame.ok) throw new Refusal(`git blame failed: ${blame.out}`);
  const shas = [...new Set(blame.out.split('\n').map((l) => l.match(/^([0-9a-f]{40}) \d+ \d+/)?.[1]).filter((x): x is string => !!x && !/^0+$/.test(x)))];
  const mainLine = new Set(git(['rev-list', '--first-parent', baseRef], root).split('\n'));
  const traced: Traced[] = shas.map((sha) => {
    const [date, subject] = git(['log', '-1', '--format=%ad%x00%s', '--date=short', sha], root).split('\0');
    const t: Traced = { sha: short(sha), date, subject };
    // The first commit on the base's own line that contains this one is where it landed: the commit itself
    // (a squash or a direct commit), else the earliest merge on that line.
    let landed: string | undefined;
    if (mainLine.has(sha)) landed = sha;
    else landed = git(['rev-list', '--ancestry-path', '--merges', '--reverse', `${sha}..${baseRef}`], root).split('\n').find((c) => mainLine.has(c));
    if (!landed) return t;
    t.landed = short(landed);
    const landedSubject = git(['log', '-1', '--format=%s', landed], root);
    const pr = landedSubject.match(PR_MERGE);
    const slug = (pr ? pr[2].match(PLAN_BRANCH)?.[1] : undefined) ?? landedSubject.match(BRANCH_MERGE)?.[1];
    const prNo = pr?.[1] ?? landedSubject.match(SQUASH)?.[1];
    if (prNo) t.pr = Number(prNo);
    if (slug) {
      t.plan = slug;
      const rel = planRelIn(slug, root);
      if (existsSync(join(root, rel))) t.record = `${rel}/RECORD.md`;
    } else if (t.pr) {
      const rel = planByPr(root, t.pr);
      if (rel) {
        t.record = `${rel}/RECORD.md`;
        t.plan = rel.split('/').pop()?.replace(/^\d{4}-\d{2}-\d{2}-/, '');
      }
    }
    // Within the plan branch, the nearest `merge task <id>` above the commit names the task that built it.
    if (landed !== sha)
      for (const c of git(['rev-list', '--ancestry-path', '--merges', '--reverse', `${sha}..${landed}`], root).split('\n').filter((c) => c && c !== landed)) {
        const task = git(['log', '-1', '--format=%s', c], root).match(TASK_MERGE)?.[1];
        // Only a merge that brought the commit in: on its task side (second parent), not already on the plan branch.
        if (task && gitOk(['merge-base', '--is-ancestor', sha, `${c}^2`], root) && !gitOk(['merge-base', '--is-ancestor', sha, `${c}^1`], root)) {
          t.task = task;
          break;
        }
      }
    return t;
  });
  if (!traced.length) return { message: `No commit on ${baseRef} brought ${spec} in.`, data: { commits: [] } };
  const lines = traced.flatMap((t) => [
    `${t.sha} ${t.date} ${t.subject}`,
    t.landed
      ? `  landed in ${base} with ${t.landed}${t.pr ? ` (PR #${t.pr})` : ''}${t.plan ? `, plan ${t.plan}` : ''}${t.task ? `, task ${t.task}` : ''}`
      : `  not in ${baseRef} yet`,
    ...(t.record ? [`  record: ${t.record}`] : []),
  ]);
  return { message: lines.join('\n'), data: { commits: traced, base: baseRef } };
}

