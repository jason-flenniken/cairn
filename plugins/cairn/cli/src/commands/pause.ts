import { join } from 'node:path';
import { loadConfig, worktreeRoot } from '../config.ts';
import { git } from '../git.ts';
import { planBranchesFor, planRef, worktreeName, type Ctx } from '../locate.ts';
import { allTasks } from '../ready.ts';
import { nextFor, summary } from '../render.ts';
import { HANDOFF_SECTIONS } from '../sections.ts';
import { loadState, log } from '../state.ts';
import { hashText, now, readText, Refusal } from '../util.ts';
import { docProblems, ensureExcluded, gate, mutate, planCtx, planFile, type Opts, type Result } from '../shared.ts';
import { procedurePath } from './status.ts';

export function cmdPause(ctx: Ctx, opts: Opts): Result {
  const pc = planCtx(ctx);
  const md = readText(planFile(pc, 'handoff.md'));
  return mutate(pc, 'paused', (s) => {
    if (s.stage === 'closed') throw new Refusal('the plan is closed');
    if (s.paused) throw new Refusal('the plan is already paused', ['cairn resume']);
    const problems = docProblems(md, 'handoff.md', HANDOFF_SECTIONS);
    const hash = md ? hashText(md) : undefined;
    const lastHash = [...s.log].reverse().find((l) => l.event === 'paused')?.detail;
    if (hash && hash === lastHash) problems.push('handoff.md is unchanged since the last pause');
    gate(!problems.length, s, 'pause', opts, problems.join('; '), ['write handoff.md from templates/handoff.md: what is in flight, open questions, the next action']);
    s.paused = { at: now(), mode: opts.now ? 'now' : 'drain', handoffHash: hash };
    log(s, 'paused', hash);
    return { message: `Paused "${s.title}". To pick up later: open Claude Code in this worktree and run /cairn:next (or /cairn:resume ${s.slug} from main).` };
  });
}

export function cmdResume(ctx: Ctx, slug: string | undefined, opts: Opts): Result {
  if (slug && ctx.plan?.slug !== slug) {
    const ref = planRef(slug, ctx.worktrees);
    const branch = planBranchesFor(slug, ctx.top)[0];
    if (!branch) throw new Refusal(`no plan named "${slug}"`, ['cairn status --all']);
    if (!ref.worktree) {
      const cfg = loadConfig(ctx.top, ctx.mainRoot);
      const wt = join(worktreeRoot(cfg, ctx.mainRoot), worktreeName(branch));
      git(['worktree', 'add', '-q', wt, branch], ctx.top);
      ensureExcluded(ctx.mainRoot, '.claude/worktrees/');
      ref.worktree = wt;
    }
    return {
      message: `Plan "${slug}" lives in ${ref.worktree}. Switch into it (EnterWorktree with that path, or \`cd ${ref.worktree} && claude\`), then run /cairn:resume.`,
      data: { slug, worktree: ref.worktree, switchRequired: true },
    };
  }
  const pc = planCtx(ctx);
  const wasPaused = !!loadState(pc.plan.dir).paused;
  const r = mutate(pc, wasPaused ? 'resumed' : undefined, (s) => {
    if (s.paused) {
      log(s, 'resumed', `paused since ${s.paused.at.slice(0, 10)}`);
      s.paused = null;
    }
    const next = nextFor(s);
    const running = allTasks(s).filter((x) => x.status === 'in_progress');
    return {
      message: [
        wasPaused ? `Resumed "${s.title}".` : `"${s.title}" was not paused.`,
        summary(s),
        ...running.map((x) => `  in flight: ${x.name} (${x.substep}${x.fixRound ? `, fix round ${x.fixRound}` : ''}) at ${x.worktree}`),
        `Next: ${next.text}`,
      ].join('\n'),
      data: { procedure: procedurePath(next.procedure), handoff: readText(planFile(pc, 'handoff.md')) ?? null },
    };
  });
  return r;
}
