import { git, gitOk } from '../git.ts';
import { planRelOf, type Ctx } from '../locate.ts';
import { currentPhase } from '../ready.ts';
import { levelOf, loadState, log, setStage } from '../state.ts';
import type { State, Suggestion } from '../types.ts';
import { CliError, Refusal } from '../util.ts';
import { gate, mutate, planCtx, runTests, testsGate, type Opts, type Result, type TestRun } from '../shared.ts';

/** "3 new suggestions (2 tests, 1 security)" for suggestions logged since the last phase boundary. */
export function newSuggestionsText(s: State): string {
  const since = [...s.log].reverse().find((l) => l.event === 'phase finished' || (l.event === 'advanced' && l.detail === 'execute'))?.at ?? s.created;
  const fresh = (s.suggestions ?? []).filter((x: Suggestion) => !x.resolves && !x.declines && x.at > since);
  if (!fresh.length) return '0 new suggestions';
  const by = new Map<string, number>();
  for (const x of fresh) by.set(x.area, (by.get(x.area) ?? 0) + 1);
  return `${fresh.length} new suggestion${fresh.length === 1 ? '' : 's'} (${[...by].map(([a, n]) => `${n} ${a}`).join(', ')})`;
}

/** Finish the current phase when it is built, clean and green; no human step. */
export function cmdPhase(ctx: Ctx, action: string | undefined, opts: Opts): Result {
  if (action !== 'finish') throw new CliError('usage: cairn phase finish');
  const pc = planCtx(ctx);
  const { plan } = pc;
  const pre = loadState(plan.dir);
  const phase = currentPhase(pre);
  if (pre.stage !== 'execute' || !phase) throw new Refusal(`the plan is in ${pre.stage}, with no phase to finish`, ['cairn next']);
  if (pre.paused) throw new Refusal('the plan is paused', ['cairn resume']);
  const unfinished = phase.tasks.filter((x) => x.status !== 'done');
  if (unfinished.length) throw new Refusal(`phase "${phase.name}" still has unfinished tasks: ${unfinished.map((x) => x.name).join(', ')}`, ['cairn ready']);
  const blocked = phase.tasks.filter((x) => x.substep === 'blocked');
  if (blocked.length) throw new Refusal(`blocked tasks: ${blocked.map((x) => x.name).join(', ')}`);
  const dirty = git(['status', '--porcelain', '--', '.', `:!${planRelOf(plan)}`], plan.worktree);
  if (dirty) throw new Refusal(`the plan worktree has uncommitted changes outside docs/sdlc: ${dirty.split('\n').slice(0, 5).join(', ')}`, ['work belongs on task branches: move it into a task, or discard it']);

  // Reuse the last task's green test run when no code changed since; otherwise run the tests once.
  const head = git(['rev-parse', 'HEAD'], plan.worktree);
  const last = [...phase.tasks].filter((x) => x.testedCommit).sort((a, b) => (a.doneAt ?? '').localeCompare(b.doneAt ?? '')).pop();
  const reused = !!(last?.testedCommit && last.tests && gitOk(['diff', '--quiet', last.testedCommit, head, '--', '.', ':!docs/sdlc'], plan.worktree));
  const tests: TestRun | undefined = reused ? undefined : runTests(pc.cfg, plan.worktree);

  return mutate(pc, `phase finished: ${phase.name}`, (s) => {
    const cur = currentPhase(s)!;
    gate(cur.verdict?.result !== 'red', s, 'phase finish', opts, `the on-track check for "${cur.name}" is red${cur.verdict?.note ? ` (${cur.verdict.note})` : ''}`, ['fix what the report flags, then re-run `cairn evidence phase`']);
    if (!reused) testsGate(tests, s, 'phase finish', opts);
    const testText = reused ? `tests green (${last!.tests!.split(' → ').pop()})` : tests ? `tests ${tests.ok ? 'green' : 'RED'} (${tests.tail})` : 'no test command';
    const suggestions = newSuggestionsText(s);
    const drift = s.drift.filter((d) => !d.acked);
    cur.status = 'done';
    log(s, 'phase finished', `${cur.name} (${testText})`);
    const following = currentPhase(s);
    let next: string;
    if (following) {
      following.status = 'in_progress';
      next = `next phase "${following.name}"`;
    } else {
      setStage(s, 'verify');
      log(s, 'advanced', 'verify');
      next = 'moved to Check';
    }
    const driftText = drift.length ? `; ${drift.length} out-of-scope edit(s): ${drift.slice(0, 5).map((d) => d.path).join(', ')}` : '';
    return {
      message: `Phase "${cur.name}" finished: ${cur.tasks.length} tasks, ${testText}, ${suggestions}${driftText}; ${next}.`,
      data: { phase: cur.id, next: following?.id ?? null, stage: s.stage },
    };
  });
}

/**
 * Run the configured suite in the plan worktree and report it. At MVP a red run files its hardening item and the command
 * still succeeds; at the other levels a red run is only reported, because Check's own fix loop handles it.
 */
export function cmdTest(ctx: Ctx, opts: Opts): Result {
  const pc = planCtx(ctx);
  const tests = runTests(pc.cfg, pc.plan.worktree);
  return mutate(pc, undefined, (s) => {
    if (!tests) {
      testsGate(tests, s, 'check', opts);
      return { message: 'No test command configured: nothing was run.', data: { ran: false } };
    }
    if (tests.ok || levelOf(s) === 'mvp') testsGate(tests, s, 'check', opts);
    const note = !tests.ok && levelOf(s) === 'mvp' ? ' Recorded as a hardening item; the plan continues.' : '';
    return { message: `Tests ${tests.ok ? 'green' : 'RED'} (\`${tests.cmd}\` → ${tests.tail}).${note}`, data: { ran: tests.ran, ok: tests.ok, command: tests.cmd, summary: tests.tail } };
  });
}
