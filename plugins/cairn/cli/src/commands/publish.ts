import { emptyLink, ISSUE_KEY, linearConfig, queueStatus, queueWrite } from '../linear.ts';
import { planRelOf, type Ctx } from '../locate.ts';
import { allTasks } from '../ready.ts';
import { log } from '../state.ts';
import type { LinearLink, LinearWrite, Phase, State, Task } from '../types.ts';
import { CliError, Refusal } from '../util.ts';
import { mutate, planCtx, type Opts, type Result } from '../shared.ts';
import { syncTickets } from './linear.ts';
import type { LinearConfig } from '../types.ts';

/**
 * A plan written without Linear tickets, grouped into the tickets it would file: each task's `ticket:` from plan.md,
 * else its phase's name. Recomputed from the plan every time, so publishing and marking sent agree.
 */
export function ticketGroups(s: State): Map<string, Task[]> {
  const out = new Map<string, Task[]>();
  for (const p of s.phases)
    for (const t of p.tasks) {
      const name = t.ticket ?? p.name;
      out.set(name, [...(out.get(name) ?? []), t]);
    }
  return out;
}

const STAGES = ['plan', 'execute'];

/** `cairn linear publish --project <p> [--milestone <m>]`: queue the epic now; its tickets follow once the epic has a key. */
export function publish(ctx: Ctx, opts: Opts): Result {
  const pc = planCtx(ctx);
  const cfg = linearConfig(pc.cfg);
  if (!cfg) throw new Refusal('Linear is not set up for this repo: .cairn/config.json has no "linear" block', ['add "linear": { "team": "<team key, e.g. SAV>" }, then retry']);
  const project = typeof opts.project === 'string' ? opts.project.trim() : '';
  if (!project) throw new CliError('cairn linear publish needs --project "<Linear project name>" (and optionally --milestone "<name>")');
  const milestone = typeof opts.milestone === 'string' && opts.milestone.trim() ? opts.milestone.trim() : undefined;
  return mutate(pc, 'plan put in Linear', (s) => {
    if (s.linear?.issues.length) throw new Refusal('this plan already has Linear issues', ['it is in Linear already: cairn linear status']);
    if (s.linear?.outbox.some((w) => w.publish)) throw new Refusal('this plan is already being put in Linear', ['send what is queued: cairn linear pending']);
    if (!STAGES.includes(s.stage) || !allTasks(s).length) throw new Refusal(`a plan is put in Linear once its tasks are loaded (it is in ${s.stage})`, ['cairn plan load first']);
    const l = (s.linear ??= emptyLink(cfg.team));
    l.project = project;
    if (milestone) l.milestone = milestone;
    const groups = ticketGroups(s);
    queueWrite(l, {
      kind: 'createIssue',
      target: `${s.slug}:epic`,
      payload: {
        team: l.team,
        title: s.title,
        description: `Planned in cairn plan "${s.title}" (\`${s.branch}\`). PRD: \`${planRelOf(pc.plan)}/prd.md\`.\n\n${groups.size} ticket${groups.size === 1 ? '' : 's'} follow as sub-issues.`,
        project,
        ...(milestone ? { milestone } : {}),
      },
      why: `the epic for plan "${s.title}"`,
      dedupe: `publish:epic`,
      publish: { role: 'epic' },
    });
    log(s, 'plan put in Linear', `${project}${milestone ? ` / ${milestone}` : ''}: epic and ${groups.size} tickets`);
    return {
      message: `Queued the epic for "${s.title}" in ${project}${milestone ? ` (${milestone})` : ''}. Once it is filed (\`cairn linear sent <id> --ref <KEY>\`), its ${groups.size} ticket${groups.size === 1 ? '' : 's'} are queued: ${[...groups.keys()].join('; ')}.`,
      data: { tickets: [...groups].map(([name, ts]) => ({ name, tasks: ts.map((t) => t.id) })) },
    };
  });
}

/** A published plan's tickets by name: on a re-plan, a task whose ticket was filed keeps its key. */
export function publishedTickets(l: LinearLink | undefined): Map<string, string> {
  return new Map((l?.outbox ?? []).filter((w) => w.publish?.role === 'ticket' && w.ref).map((w) => [w.publish!.ticket!, w.ref!]));
}

/** Set `task.issue` from the filed tickets on a published plan's re-plan. */
export function keepPublishedTickets(l: LinearLink, phases: Phase[]): void {
  const keys = publishedTickets(l);
  for (const p of phases)
    for (const t of p.tasks) {
      const k = keys.get(t.ticket ?? p.name);
      if (k) t.issue = k;
      else delete t.issue;
    }
}

/** `linear sent --ref` on a publish entry: record the new issue, then queue what waited on it. Returns a line for the message. */
export function onPublishSent(s: State, w: LinearWrite, ref: string | undefined, cfg: LinearConfig | undefined): string | undefined {
  const l = s.linear!;
  if (!w.publish) return undefined;
  if (!ref || !ISSUE_KEY.test(ref)) throw new Refusal(`${w.id} files a new issue: cairn needs its key`, [`cairn linear sent ${w.id} --ref <the new issue key, e.g. SAV-131>`]);
  const groups = ticketGroups(s);
  if (w.publish.role === 'epic') {
    l.epic = ref;
    l.issues.push({ key: ref, title: s.title, blockedBy: [], stateType: 'unstarted', requirements: [], ...(l.milestone ? { milestone: l.milestone } : {}) });
    if (s.stage === 'execute') queueStatus(l, cfg, ref, 'inProgress', 'the plan is building this epic');
    for (const [name, ts] of groups)
      queueWrite(l, {
        kind: 'createIssue',
        target: `${s.slug}:ticket:${name}`,
        payload: {
          team: l.team,
          title: name,
          description: `Part of cairn plan "${s.title}" (\`${s.branch}\`).\n\n${ts.map((t) => `- ${t.name} (${t.covers.join(', ') || 'groundwork'})`).join('\n')}`,
          parentId: ref,
          ...(l.project ? { project: l.project } : {}),
          ...(l.milestone ? { milestone: l.milestone } : {}),
        },
        why: `ticket "${name}" under ${ref}`,
        dedupe: `publish:ticket:${name}`,
        publish: { role: 'ticket', ticket: name },
      });
    return `${ref} is the epic; ${groups.size} ticket${groups.size === 1 ? '' : 's'} queued under it.`;
  }
  const name = w.publish.ticket!;
  const ts = groups.get(name) ?? [];
  l.issues.push({ key: ref, title: name, parent: l.epic, blockedBy: [], stateType: 'unstarted', requirements: [...new Set(ts.flatMap((t) => t.covers))], ...(l.milestone ? { milestone: l.milestone } : {}) });
  for (const t of ts) t.issue = ref;
  // Once every ticket has its key, the order between tickets goes to Linear as blocked-by links.
  const filed = l.outbox.filter((x) => x.publish?.role === 'ticket');
  if (filed.every((x) => x.sentAt || x === w)) {
    const keyOf = new Map(allTasks(s).filter((t) => t.issue).map((t) => [t.id, t.issue!]));
    for (const t of allTasks(s))
      for (const b of t.blockedBy) {
        const [mine, theirs] = [keyOf.get(t.id), keyOf.get(b)];
        if (!mine || !theirs || mine === theirs) continue;
        const issue = l.issues.find((i) => i.key === mine)!;
        if (!issue.blockedBy.includes(theirs)) issue.blockedBy.push(theirs);
        queueWrite(l, { kind: 'relation', target: mine, payload: { id: mine, blockedBy: [theirs] }, why: `${mine} needs ${theirs}`, dedupe: `relation:${mine}:${theirs}` });
      }
  }
  syncTickets(s, cfg);
  return `${ref} is ticket "${name}" (${ts.length} task${ts.length === 1 ? '' : 's'}).`;
}
