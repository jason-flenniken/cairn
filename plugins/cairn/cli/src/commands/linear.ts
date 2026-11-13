import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildBoard, ownerOf, type BoardIssue } from '../board.ts';
import { loadConfig } from '../config.ts';
import { commonDir, gitOk, gitTry, landedState, prMerged, safeRef } from '../git.ts';
import {
  effectiveBlockers,
  emptyLink,
  findIssueCycle,
  isDone,
  issueProgress,
  issueRequirements,
  keysText,
  linearConfig,
  notTakenReason,
  outsideBlockers,
  parentKeys,
  parseJson,
  prdLinearProblems,
  queueComment,
  queueStatus,
  queueWrite,
  statusFor,
  readBoardImport,
  mergeBoard,
  isFoundational,
  isPublished,
  hasTicketTasks,
  settled,
  issueFile,
  blockersText,
  readPlanImport,
  takenIssues,
  unsent,
  due,
  claimedNow,
  WRITE_TOOL,
  ISSUE_KEY,
  type BoardSnapshot,
} from '../linear.ts';
import { planRelOf, resolvePlanDir, type Ctx } from '../locate.ts';
import { loadState, log } from '../state.ts';
import type { LinearChange, LinearConfig, LinearIssue, LinearLink, State } from '../types.ts';
import { CliError, hashText, now, readText, Refusal, writeText } from '../util.ts';
import { gate, mutate, planCtx, type Opts, type PlanCtx, type Result } from '../shared.ts';
import { collectSuggestions } from './suggest.ts';
import { listPlans, stackBase } from './status.ts';
import { onPublishSent, publish } from './publish.ts';

const USAGE = `usage: cairn linear [status] | import (--file <path> | stdin) [--refresh | --board] | pending [--json] | sent <id> [--ref <key or url>]
  | drop <id> --note "…" | hold <id> --note "…" | depends <KEY> --on <KEY> --reason "…" | ack <change> --as taken|later|noted [--note "…"]
  | release <KEY> --reason "…" | take <KEY> --reason "…" | board [--project "<name>"] [--json] | relink <EPIC> [--project "<name>"] [--json] | publish --project "<name>" [--milestone "<name>"]`;

const NO_CONFIG = (where: string) =>
  new Refusal(`Linear is not set up for this repo: ${where} has no "linear" block`, [`add "linear": { "team": "<team key, e.g. SAV>" } to ${where}, then retry`]);

/** The input JSON: --file, or what main() read from stdin. */
function inputText(ctx: Ctx, opts: Opts): string {
  if (typeof opts.file === 'string') {
    const t = readText(join(ctx.cwd, opts.file)) ?? readText(opts.file);
    if (t === undefined) throw new CliError(`cannot read --file ${opts.file}`);
    return t;
  }
  if (typeof opts.stdin === 'string' && opts.stdin.trim()) return opts.stdin;
  throw new CliError('cairn linear import needs the issues as JSON: pipe them in, or pass --file <path>');
}

export function cmdLinear(ctx: Ctx, sub: string | undefined, arg: string | undefined, opts: Opts): Result {
  switch (sub) {
    case undefined:
    case 'status':
      return linearStatus(ctx);
    case 'import':
      return opts.board ? importBoard(ctx, opts) : opts.refresh ? refreshPlan(ctx, opts) : importPlan(ctx, opts);
    case 'pending':
      return pending(ctx, opts);
    case 'sent':
      return markSent(ctx, arg, opts);
    case 'drop':
      return drop(ctx, arg, opts);
    case 'hold':
      return hold(ctx, arg, opts);
    case 'depends':
      return depends(ctx, arg, opts);
    case 'ack':
      return ack(ctx, arg, opts);
    case 'release':
      return release(ctx, arg, opts);
    case 'take':
      return take(ctx, arg, opts);
    case 'board':
      return board(ctx, opts);
    case 'relink':
      return relink(ctx, arg, opts);
    case 'publish':
      return publish(ctx, opts);
    default:
      throw new CliError(USAGE);
  }
}

function linkOf(s: State): LinearLink {
  if (!s.linear)
    throw new Refusal('this plan has no Linear issues', [
      ['discover', 'prd', 'repro'].includes(s.stage) ? 'pull them in first: cairn linear import --file <issues.json>' : 'issues are pulled in when a plan starts: start a new plan for them with /cairn:new --from-linear',
    ]);
  return s.linear;
}

/** Commit cairn's own bookkeeping, except on a closed plan, whose branch may already be merged: merge-check commits it. */
const bookkeeping = (s: State, msg: string) => (s.stage === 'closed' ? undefined : msg);

// ---------- Import ----------

/** Other plans' issues, for "already in plan X" notes and the ship check. */
function otherPlans(ctx: Ctx, slug?: string): { slug: string; stage: State['stage']; state: State }[] {
  try {
    return listPlans(ctx).filter((r) => wellFormed(r.state.linear) && r.state.slug !== slug).map((r) => ({ slug: r.state.slug, stage: r.state.stage, state: r.state }));
  } catch {
    return [];
  }
}

/** Another branch's state is committed, so untrusted: only a link of the expected shape is read. */
function wellFormed(l: unknown): l is LinearLink {
  if (!l || typeof l !== 'object') return false;
  const x = l as Partial<LinearLink>;
  const issuesOk = (v: unknown) => Array.isArray(v) && v.every((i) => i && typeof i.key === 'string' && Array.isArray(i.blockedBy) && i.blockedBy.every((b: unknown) => typeof b === 'string'));
  return issuesOk(x.issues) && issuesOk(x.known) && Array.isArray(x.depends) && x.depends.every((d) => d && typeof d.key === 'string' && typeof d.on === 'string') && Array.isArray(x.outbox) && Array.isArray(x.changes);
}

function importPlan(ctx: Ctx, opts: Opts): Result {
  const pc = planCtx(ctx);
  const cfg = linearConfig(pc.cfg);
  if (!cfg) throw NO_CONFIG('.cairn/config.json');
  const doc = readPlanImport(parseJson(inputText(ctx, opts), 'the import'));
  const others = otherPlans(ctx, pc.plan.slug);
  return mutate(pc, 'Linear issues imported', (s) => {
    if (s.linear) throw new Refusal('this plan already has its Linear issues', ['to re-read them from Linear: cairn linear import --refresh --file <issues.json>']);
    if (!['discover', 'prd', 'repro'].includes(s.stage)) throw new Refusal(`issues are pulled in when a plan starts; this one is in ${s.stage}`, ['start a new plan for them with /cairn:new --from-linear']);
    const l: LinearLink = { ...emptyLink(doc.team ?? cfg.team), ...(doc.project ? { project: doc.project } : {}), ...(doc.milestone ? { milestone: doc.milestone } : {}), ...(doc.epic ? { epic: doc.epic } : {}), ...(doc.selection ? { selection: doc.selection } : {}), issues: doc.issues, known: doc.known };
    s.linear = l;
    writeIssueTexts(pc, s, doc.descriptions);
    log(s, 'Linear issues imported', `${doc.issues.length}: ${keysText(doc.issues)}`);
    const lines = [`Pulled in ${doc.issues.length} Linear issue${doc.issues.length === 1 ? '' : 's'}: ${keysText(doc.issues)}.`];
    const texts = doc.issues.filter((i) => doc.descriptions.has(i.key)).length;
    lines.push(texts ? `Saved the text of ${texts} issue${texts === 1 ? '' : 's'} under ${planRelOf(pc.plan)}/issues/.` : 'No issue text was read: fetch the issues with "description" in the fields list and refresh, or discover works from titles only.');
    if (isFoundational(l, cfg)) lines.push(`Foundational: an issue carries the "${cfg.foundationalLabel ?? 'foundational'}" label, so the plan must name its approach and the ones it rejected (## Approaches considered).`);
    const parents = parentKeys(doc.issues);
    if (parents.size) {
      const leaves = doc.issues.filter((i) => !parents.has(i.key));
      lines.push(`Epic${parents.size === 1 ? '' : 's'} ${[...parents].join(', ')}: ${leaves.length} sub-issue${leaves.length === 1 ? '' : 's'} to build.${leaves.length > 8 ? ' That is a lot for one plan: offer to take part of it now and leave the rest under ## Issues not taken ("later plan").' : ''}`);
      const elsewhere = leaves.filter((i) => i.milestone && doc.milestone && i.milestone !== doc.milestone);
      if (elsewhere.length) lines.push(`Sub-issues in other milestones came along with their parent: ${elsewhere.map((i) => `${i.key} (${i.milestone})`).join(', ')}.`);
    }
    const ob = outsideBlockers(l);
    if (ob.length)
      lines.push(
        `Blockers outside the plan and not done: ${blockersText(ob, (b) => { const o = ownerOf(others, b); return o ? ` [in plan ${o.slug}, ${o.stage}]` : ''; })}. Discover decides each: pull it in, leave the blocked issues out, or go ahead with a reason (## Outside blockers).`,
      );
    const claimed = doc.issues.map((i) => ({ i, o: ownerOf(others, i.key) })).filter((x) => x.o && x.o.stage !== 'closed');
    if (claimed.length) lines.push(`Warning: already in another active plan: ${claimed.map((x) => `${x.i.key} (${x.o!.slug}, ${x.o!.stage})`).join(', ')}.`);
    const cycle = findIssueCycle(doc.issues);
    if (cycle) lines.push(`Warning: these issues block each other in a loop: ${cycle.join(' → ')}. The plan can't load until one link is removed in Linear.`);
    return { message: lines.join('\n'), data: { issues: doc.issues.map((i) => i.key), parents: [...parents], outsideBlockers: ob, cycle: cycle ?? null } };
  });
}

/** Re-read the plan's issues from Linear: new links and new sub-issues become changes the plan has to decide about. */
function refreshPlan(ctx: Ctx, opts: Opts): Result {
  const pc = planCtx(ctx);
  const doc = readPlanImport(parseJson(inputText(ctx, opts), 'the refresh'));
  return mutate(pc, 'Linear issues refreshed', (s) => {
    const l = linkOf(s);
    if (s.stage === 'closed') throw new Refusal('the plan is closed, so it no longer follows Linear', ['see the project with /cairn:board instead']);
    const fresh = new Map([...doc.known, ...doc.issues].map((i) => [i.key, i]));
    const has = (k: string) => doc.present.get(k) ?? { blockedBy: false, parent: false, description: false, labels: false };
    const taken = new Set(takenIssues(l).map((i) => i.key));
    const noted: string[] = [];
    const added: LinearChange[] = [];
    const change = (c: Omit<LinearChange, 'id' | 'at'>) => {
      if (l.changes.some((x) => x.kind === c.kind && x.key === c.key && (c.on ? x.on === c.on : x.issue?.key === c.issue?.key))) return;
      const x: LinearChange = { id: `c${l.changes.length + 1}`, ...c, at: now() };
      l.changes.push(x);
      added.push(x);
    };
    for (const i of l.issues) {
      const f = fresh.get(i.key);
      if (!f) continue;
      if (taken.has(i.key)) {
        if (has(i.key).blockedBy) {
          for (const b of f.blockedBy) if (!i.blockedBy.includes(b) && !l.depends.some((d) => d.key === i.key && d.on === b) && !isDone(fresh.get(b))) change({ kind: 'link', key: i.key, on: b });
          for (const b of i.blockedBy) if (!f.blockedBy.includes(b)) noted.push(`${i.key} is no longer blocked by ${b}`);
        }
        // Moved out of the epic in Linear: it leaves the plan too, and says so on the issue.
        if (has(i.key).parent && i.parent && f.parent !== i.parent && taken.has(i.parent)) {
          const reason = `moved out of ${i.parent} in Linear`;
          i.released = { at: now(), reason };
          queueComment(l, i.key, `Left cairn plan "${s.title}" (\`${s.branch}\`): ${reason}.`, `${i.key} left the plan`, 'released');
          noted.push(`${i.key} was ${reason}, so it left the plan${i.requirements?.length ? `; its requirements (${i.requirements.join(', ')}) need moving to ## Non-goals and a re-plan` : ''}`);
        }
      }
      // Links the refresh did not carry are kept as they were: a missing field is not an empty one.
      Object.assign(i, { title: f.title, url: f.url ?? i.url, stateType: f.stateType ?? i.stateType, stateName: f.stateName ?? i.stateName, milestone: f.milestone ?? i.milestone, ...(has(i.key).parent ? { parent: f.parent } : {}), ...(has(i.key).blockedBy ? { blockedBy: f.blockedBy } : {}), ...(has(i.key).labels ? { labels: f.labels } : {}) });
    }
    // Issue text read again: rewrite the files; text that changed after the PRD approval is noted, not a blocking change.
    for (const k of writeIssueTexts(pc, s, doc.descriptions)) noted.push(`${k}'s text changed after the PRD was approved: check the PRD against ${issueTextPath(pc, k)}`);
    // A sub-issue is new when the plan had never seen it; one already done in Linear needs no decision.
    const seen = new Set([...l.issues, ...l.known].map((i) => i.key));
    for (const f of [...doc.issues, ...doc.known])
      if (f.parent && taken.has(f.parent) && !seen.has(f.key) && !isDone(f)) change({ kind: 'sub-issue', key: f.parent, issue: f });
    const inPlan = new Set(l.issues.map((i) => i.key));
    l.known = [...new Map([...l.known, ...doc.known, ...doc.issues.filter((i) => !inPlan.has(i.key))].filter((i) => !inPlan.has(i.key)).map((i) => [i.key, fresh.get(i.key) ?? i])).values()];
    l.refreshedAt = now();
    log(s, 'Linear issues refreshed', [...added.map(changeText), ...noted].join('; ') || 'no changes');
    const open = l.changes.filter((c) => !c.handled);
    const lines = [added.length ? `${added.length} change${added.length === 1 ? '' : 's'} in Linear to decide about:` : 'No new links or sub-issues in Linear.', ...added.map((c) => `  ${c.id}: ${changeText(c)}`), ...noted.map((n) => `  noted: ${n}`)];
    if (open.length) lines.push(`Open: ${open.length}. The phase can't finish until each is handled: cairn linear depends, cairn linear ack <id> --as taken|later|noted, or cairn linear release.`);
    return { message: lines.join('\n'), data: { added, noted, open } };
  });
}

/** Where an issue's text lives, relative to the plan worktree. */
export const issueTextPath = (pc: PlanCtx, k: string) => `${planRelOf(pc.plan)}/issues/${k}.md`;

/**
 * Write each in-plan issue whose description was read to `issues/<KEY>.md` in the plan folder (committed with the
 * state). Returns the keys whose text changed after the PRD was approved, so the PRD can be checked against them.
 */
function writeIssueTexts(pc: PlanCtx, s: State, descriptions: Map<string, string>): string[] {
  const l = s.linear!;
  const changed: string[] = [];
  const at = now();
  for (const i of l.issues) {
    const d = descriptions.get(i.key);
    if (d === undefined) continue;
    const h = hashText(d);
    if (s.approvals.prd && i.descriptionHash && i.descriptionHash !== h) changed.push(i.key);
    i.descriptionHash = h;
    writeText(join(pc.plan.dir, 'issues', `${i.key}.md`), issueFile(i, d, at));
  }
  return changed;
}

const changeText = (c: LinearChange) => (c.kind === 'link' ? `${c.key} is now blocked by ${c.on}` : `${c.issue?.key} "${c.issue?.title}" was added under ${c.key}`);

function importBoard(ctx: Ctx, opts: Opts): Result {
  const cfg = linearConfig(loadConfig(ctx.plan?.worktree, ctx.mainRoot));
  if (!cfg) throw NO_CONFIG('.cairn/config.json');
  const { snap: next, present } = readBoardImport(parseJson(inputText(ctx, opts), 'the board import'));
  const file = snapshotFile(ctx, next.project);
  // --merge folds a cheap listing (the whole project) into what is stored; --links applies just-read links on top of it;
  // with neither the import replaces the snapshot.
  if (opts.links && !existsSync(file)) throw new Refusal(`no snapshot of "${next.project}" to add links to`, ['import the listing first: cairn linear import --board --merge']);
  const prev = (opts.merge || opts.links) && existsSync(file) ? (JSON.parse(readText(file) ?? '{}') as BoardSnapshot) : undefined;
  const { snap, needRelations } = mergeBoard(prev, next, present, !!opts.links);
  // A read of every link starts with a replace or a first read, and may finish in later --links passes; when no open
  // issue is left without links, it counts as a full read, and the board counts its age.
  if (!prev) snap.fullPending = true;
  if (snap.fullPending && !needRelations.length) {
    snap.fullReadAt = snap.readAt;
    delete snap.fullPending;
  }
  writeText(file, JSON.stringify({ ...snap, team: snap.team ?? cfg.team }, null, 2) + '\n');
  const more = needRelations.length
    ? ` ${needRelations.length} open issue${needRelations.length === 1 ? '' : 's'} need their blocked-by links read: ${needRelations.join(', ')}. Read them with get_issue (relations), then import those with --links.`
    : ' Every open issue has its links.';
  return { message: `Read ${snap.issues.length} issues of "${snap.project}" from Linear.${more} Run cairn linear board to see it.`, data: { file, issues: snap.issues.length, needRelations, fullReadAt: snap.fullReadAt ?? null } };
}

// ---------- The queue ----------

/** The cached `gh` answers about merged pull requests, shared with `cairn status`. */
const PR_CACHE = 'cairn-pr-state.json';

const doneQueued = (l: LinearLink) => !!l.mergedAt || l.outbox.some((w) => w.dedupe.startsWith('status:') && w.dedupe.endsWith(':done'));

/**
 * Whether the plan's branch has landed and its Done statuses are not queued yet. It may ask `gh`, so it runs before
 * the state lock, from `cairn next` and `cairn linear pending`, never from a hook.
 */
export function mergedAwaitingDone(pc: PlanCtx, s: State): boolean {
  if (!s.linear || (s.stage !== 'learn' && s.stage !== 'closed') || doneQueued(s.linear)) return false;
  let merged = false;
  try {
    merged = landedState(pc.plan.worktree, s.branch, s.base, planRelOf(pc.plan), join(commonDir(pc.ctx.mainRoot), PR_CACHE)) === 'merged';
  } catch {
    return false;
  }
  return merged;
}

/** Queue Done on the plan's issues once its branch has landed (checked first, outside the lock, by `mergedAwaitingDone`). */
export function queueDone(pc: PlanCtx, s: State): number {
  const l = s.linear;
  if (!l || doneQueued(l)) return 0;
  const cfg = linearConfig(pc.cfg);
  const taken = takenIssues(l);
  const parents = parentKeys(taken);
  const progress = issueProgress(s);
  let n = 0;
  // Only issues the plan built: one pulled in later and never put on a requirement stays as it is.
  for (const i of taken) if (!parents.has(i.key) && !settled(i, cfg) && progress.get(i.key) === 'shipped' && queueStatus(l, cfg, i.key, 'done', 'the pull request is merged')) n++;
  // A parent closes when every sub-issue is done: this plan's (now merged) and every other one Linear knows of.
  const all = [...l.issues, ...l.known];
  const takenKeys = new Set(taken.map((i) => i.key));
  // Only parents in the plan: their whole subtree was read. A parent outside it (a plan of one sub-issue) is left to Linear and the other plans.
  for (const p of parents) {
    const parent = all.find((i) => i.key === p);
    if (settled(parent, cfg)) continue;
    const kids = all.filter((i) => i.parent === p);
    if (kids.length && kids.every((k) => (takenKeys.has(k.key) && (parents.has(k.key) || progress.get(k.key) === 'shipped')) || settled(k, cfg)) && queueStatus(l, cfg, p, 'done', `every sub-issue of ${p} is done`)) n++;
  }
  // Recorded even when nothing was queued, so the merge is checked once.
  l.mergedAt = now();
  log(s, 'Linear: merged', n ? `${n} issue(s) to mark Done` : 'nothing to mark Done');
  return n;
}

function pending(ctx: Ctx, opts: Opts = {}): Result {
  const pc = planCtx(ctx);
  const pre = loadState(pc.plan.dir);
  linkOf(pre);
  // State is written only when the merge queued something.
  const s = mergedAwaitingDone(pc, pre) ? mutate(pc, undefined, (x) => (queueDone(pc, x), x)) : pre;
  // --claim: a sender takes the due entries nobody holds, and marks them under the lock so no second sender gets them.
  const list = opts.claim
    ? mutate(pc, undefined, (x) => {
        const at = Date.now();
        const mine = due(linkOf(x)).filter((w) => !w.needsApproval && !claimedNow(w, at));
        for (const w of mine) w.claimedAt = new Date(at).toISOString();
        return mine;
      })
    : unsent(linkOf(s));
  const lines = list.length
    ? [`${list.length} Linear update${list.length === 1 ? '' : 's'} to send${opts.claim ? ' (claimed for 10 minutes)' : ''}:`, ...list.map((w) => `  ${w.id} ${WRITE_TOOL[w.kind]} ${w.target}${w.needsApproval ? ' (ask the user first)' : ''}${w.held ? ` (held: ${w.held.note})` : ''}: ${w.why}`)]
    : ['Nothing to send to Linear.'];
  return { message: lines.join('\n'), data: { pending: list.map((w) => ({ ...w, tool: WRITE_TOOL[w.kind] })) } };
}

function entry(l: LinearLink, id: string | undefined) {
  if (!id) throw new CliError(USAGE);
  const w = l.outbox.find((x) => x.id === id);
  if (!w) throw new Refusal(`no queued Linear update "${id}"`, ['cairn linear pending']);
  return w;
}

function markSent(ctx: Ctx, id: string | undefined, opts: Opts): Result {
  const pc = planCtx(ctx);
  const pre = loadState(pc.plan.dir);
  return mutate(pc, bookkeeping(pre, 'Linear update sent'), (s) => {
    const l = linkOf(s);
    const w = entry(l, id);
    if (w.sentAt) return { message: `${w.id} was already sent${w.ref ? ` (${w.ref})` : ''}.`, data: { already: true } };
    if (w.dropped) throw new Refusal(`${w.id} was dropped: ${w.dropped.note}`, ['nothing to do; cairn linear pending lists what is left']);
    const ref = typeof opts.ref === 'string' ? opts.ref.trim() : undefined;
    // A ticket cairn filed for a published plan joins the plan: its key is recorded and what waited on it is queued.
    const filed = onPublishSent(s, w, ref, linearConfig(pc.cfg));
    w.sentAt = now();
    delete w.claimedAt;
    if (ref) w.ref = ref;
    // A follow-up filed as an issue remembers its key, so a later close never files it twice.
    if (w.kind === 'createIssue' && ref) {
      const [slug, sid] = w.target.split(':');
      const sug = slug === s.slug ? s.suggestions?.find((x) => x.id === sid) : undefined;
      if (sug) sug.linear = ref;
    }
    log(s, 'Linear update sent', `${w.id} ${w.kind} ${w.target}${ref ? ` → ${ref}` : ''}`);
    const left = unsent(l).length;
    return { message: `Marked ${w.id} sent.${filed ? ` ${filed}` : ''}${left ? ` ${left} left.` : ' Nothing left to send.'}`, data: { left } };
  });
}

function drop(ctx: Ctx, id: string | undefined, opts: Opts): Result {
  const pc = planCtx(ctx);
  if (typeof opts.note !== 'string' || !opts.note.trim()) throw new CliError('cairn linear drop needs --note "<why it is not sent>"');
  const pre = loadState(pc.plan.dir);
  return mutate(pc, bookkeeping(pre, 'Linear update dropped'), (s) => {
    const w = entry(linkOf(s), id);
    if (w.sentAt) throw new Refusal(`${w.id} was already sent`, ['nothing to do; cairn linear pending lists what is left']);
    w.dropped = { at: now(), note: String(opts.note) };
    log(s, 'Linear update dropped', `${w.id}: ${opts.note}`);
    return { message: `Dropped ${w.id}; it won't be sent.` };
  });
}

/** A send that failed, or that the user held: it stays queued and is retried at the next sync, without routing every `cairn next` to it. */
function hold(ctx: Ctx, id: string | undefined, opts: Opts): Result {
  const pc = planCtx(ctx);
  if (typeof opts.note !== 'string' || !opts.note.trim()) throw new CliError('cairn linear hold needs --note "<the error, or why it waits>"');
  const pre = loadState(pc.plan.dir);
  return mutate(pc, bookkeeping(pre, 'Linear update held'), (s) => {
    const w = entry(linkOf(s), id);
    if (w.sentAt) return { message: `${w.id} was already sent.` };
    if (w.dropped) throw new Refusal(`${w.id} was dropped: ${w.dropped.note}`, ['nothing to do; cairn linear pending lists what is left']);
    w.held = { at: now(), note: String(opts.note) };
    delete w.claimedAt;
    log(s, 'Linear update held', `${w.id}: ${opts.note}`);
    return { message: `Held ${w.id}; the next sync tries it again.` };
  });
}

// ---------- Dependencies and changes ----------

function needKey(v: unknown, what: string): string {
  const k = typeof v === 'string' ? v.toUpperCase() : '';
  if (!ISSUE_KEY.test(k)) throw new CliError(`${what} must be a Linear issue key like SAV-12`);
  return k;
}

/** A dependency found while building: record it, link it in Linear, and settle any refresh change it answers. */
function depends(ctx: Ctx, keyArg: string | undefined, opts: Opts): Result {
  const k = needKey(keyArg, 'the blocked issue');
  const on = needKey(opts.on, '--on');
  if (k === on) throw new CliError('an issue cannot block itself');
  if (typeof opts.reason !== 'string' || !opts.reason.trim()) throw new CliError('cairn linear depends needs --reason "<what it needs from the blocker>"');
  const reason = opts.reason.trim();
  const pc = planCtx(ctx);
  return mutate(pc, `Linear: ${k} depends on ${on}`, (s) => {
    const l = linkOf(s);
    const issue = l.issues.find((i) => i.key === k && !i.released);
    if (!issue) throw new Refusal(`${k} is not one of this plan's issues`, ['cairn linear status lists them']);
    const cycle = findIssueCycle([...l.issues, ...l.known], [...l.depends, { key: k, on, reason, at: '' }], true);
    if (cycle?.includes(k) && cycle.includes(on)) throw new Refusal(`that would make a loop: ${cycle.join(' → ')}`, ['record the dependency the other way round, or not at all']);
    const fresh = !l.depends.some((d) => d.key === k && d.on === on);
    if (fresh) l.depends.push({ key: k, on, reason, at: now() });
    // A link Linear already has needs no write; one found here is added (blockedBy only adds) with a comment saying why.
    if (!issue.blockedBy.includes(on)) {
      queueWrite(l, { kind: 'relation', target: k, payload: { id: k, blockedBy: [on] }, why: `${k} needs ${on}`, dedupe: `relation:${k}:${on}` });
      queueComment(l, k, `Found while building: this needs ${on}. ${reason}`, `why ${k} now waits on ${on}`, `depends:${on}`);
    }
    for (const c of l.changes) if (!c.handled && c.kind === 'link' && c.key === k && c.on === on) c.handled = { at: now(), how: 'depends', note: reason };
    log(s, 'Linear dependency', `${k} on ${on}: ${reason}`);
    const inPlan = l.issues.some((i) => i.key === on && !i.released);
    const blocker = [...l.issues, ...l.known].find((i) => i.key === on);
    const next = inPlan
      ? 'Both issues are in this plan: re-plan so the tasks for it come after the tasks for the blocker (cairn plan load --replan), then the plan needs approval again.'
      : isDone(blocker)
        ? `${on} is already done in Linear; nothing to wait for.`
        : `${on} is outside this plan and not done. Ask the user: pull it in (amend the PRD, re-plan), drop ${k} (cairn linear release ${k} --reason "…"), stub it with a follow-up, or pause.`;
    return { message: `${fresh ? 'Recorded' : 'Already recorded'}: ${k} depends on ${on}. ${next}`, data: { inPlan, done: isDone(blocker) } };
  });
}

const ACK_AS = ['taken', 'later', 'noted'] as const;

/** Decide about a change seen on refresh: pull the issue in, leave it for a later plan, or note that it does not block. */
function ack(ctx: Ctx, id: string | undefined, opts: Opts): Result {
  const as = String(opts.as ?? '');
  if (!id || !(ACK_AS as readonly string[]).includes(as)) throw new CliError('usage: cairn linear ack <change id> --as taken|later|noted [--note "…"]');
  const note = typeof opts.note === 'string' ? opts.note.trim() : undefined;
  if (as === 'noted' && !note) throw new CliError('--as noted needs --note "<why it does not block>"');
  const pc = planCtx(ctx);
  return mutate(pc, `Linear change ${id} handled`, (s) => {
    const l = linkOf(s);
    const c = l.changes.find((x) => x.id === id);
    if (!c) throw new Refusal(`no change "${id}"`, ['cairn linear status lists open changes']);
    if (c.handled) return { message: `${id} was already handled (${c.handled.how}).` };
    const subject = c.kind === 'link' ? c.on! : c.issue!.key;
    let msg: string;
    if (as === 'taken') {
      const issue = c.issue ?? l.known.find((i) => i.key === subject);
      if (!issue) throw new Refusal(`cairn has no details for ${subject}`, ['refresh with it included: cairn linear import --refresh']);
      if (!l.issues.some((i) => i.key === subject)) l.issues.push({ ...issue, blockedBy: [...issue.blockedBy] });
      msg = `${subject} is now part of the plan. Next: add requirements tagged [${subject}] to the PRD, then re-plan (cairn plan load --replan).`;
    } else if (as === 'later') {
      if (c.kind === 'sub-issue' && !l.issues.some((i) => i.key === subject)) l.issues.push({ ...c.issue!, released: { at: now(), reason: note ?? 'later plan' } });
      msg = `${subject} stays out of this plan${note ? `: ${note}` : ''}.`;
    } else msg = `Noted: ${changeText(c)} does not hold this plan up: ${note}.`;
    // An issue now on the plan's list is no longer only known.
    l.known = l.known.filter((i) => !l.issues.some((x) => x.key === i.key));
    c.handled = { at: now(), how: as as 'taken' | 'later' | 'noted', ...(note ? { note } : {}) };
    log(s, 'Linear change handled', `${id} ${as}${note ? `: ${note}` : ''}`);
    return { message: msg };
  });
}

/** Take an issue out of the plan and hand it back in Linear. */
function release(ctx: Ctx, keyArg: string | undefined, opts: Opts): Result {
  const k = needKey(keyArg, 'the issue');
  if (typeof opts.reason !== 'string' || !opts.reason.trim()) throw new CliError('cairn linear release needs --reason "…"');
  const reason = opts.reason.trim();
  const pc = planCtx(ctx);
  return mutate(pc, `Linear: released ${k}`, (s) => {
    const l = linkOf(s);
    const i = l.issues.find((x) => x.key === k);
    if (!i) throw new Refusal(`${k} is not one of this plan's issues`, ['cairn linear status lists them']);
    if (i.released) return { message: `${k} was already released.` };
    i.released = { at: now(), reason };
    for (const c of l.changes) if (!c.handled && (c.key === k || c.issue?.key === k)) c.handled = { at: now(), how: 'released', note: reason };
    queueComment(l, k, `Released from cairn plan "${s.title}" (\`${s.branch}\`): ${reason}`, `${k} left the plan`, 'released');
    log(s, 'Linear issue released', `${k}: ${reason}`);
    const tagged = i.requirements?.length ? ` Its requirements (${i.requirements.join(', ')}) are still in the PRD: move them under ## Non-goals or drop them, then re-plan.` : '';
    return { message: `Released ${k}: ${reason}.${tagged}` };
  });
}

/** Undo a release: put an issue that was taken out of the plan back in. */
function take(ctx: Ctx, keyArg: string | undefined, opts: Opts): Result {
  const k = needKey(keyArg, 'the issue');
  if (typeof opts.reason !== 'string' || !opts.reason.trim()) throw new CliError('cairn linear take needs --reason "…"');
  const reason = opts.reason.trim();
  const pc = planCtx(ctx);
  const prdMd = readText(join(pc.plan.dir, 'prd.md'));
  return mutate(pc, `Linear: took back ${k}`, (s) => {
    const l = linkOf(s);
    const i = l.issues.find((x) => x.key === k);
    if (!i) throw new Refusal(`${k} is not one of this plan's issues`, ['cairn linear status lists them']);
    if (!i.released) return { message: `${k} is already in the plan.` };
    if (prdMd && notTakenReason(prdMd, k)) throw new Refusal(`prd.md still lists ${k} under ## Issues not taken`, [`remove that line from prd.md, then run cairn linear take ${k} again`]);
    delete i.released;
    // A "left out" comment not sent yet would now be wrong; one already sent gets a correction.
    const dedupe = `comment:${k}:released`;
    for (const w of l.outbox) if (w.dedupe === dedupe && !w.sentAt && !w.dropped) w.dropped = { at: now(), note: `${k} is back in the plan: ${reason}` };
    if (l.outbox.some((w) => w.dedupe === dedupe && w.sentAt))
      queueComment(l, k, `Back in cairn plan "${s.title}" (\`${s.branch}\`): ${reason}`, `${k} is back in the plan`, 'taken-back');
    log(s, 'Linear issue taken back', `${k}: ${reason}`);
    const parent = l.issues.some((x) => x.parent === k && !x.released);
    const next = parent || i.requirements?.length ? '' : ` Next: add requirements tagged [${k}] to the PRD, then re-plan (cairn plan load --replan).`;
    return { message: `${k} is back in the plan.${next}` };
  });
}

// ---------- Hooks into the plan's own moves ----------

/** On `approve prd`: refuse while issues are untagged or outside blockers undecided. */
export function linearPrdGate(s: State, prdMd: string | undefined, opts: Opts): void {
  if (!s.linear || !prdMd || isPublished(s.linear)) return;
  const problems = prdLinearProblems(s.linear, prdMd);
  gate(!problems.length, s, 'approve prd', opts, problems.join('; '), ['fix prd.md, then approve again']);
}

/** Record each issue's requirements from the PRD. Issues under `## Issues not taken` are released. */
export function recordRequirements(s: State, prdMd: string): void {
  const l = s.linear;
  if (!l || isPublished(l)) return;
  const reqs = issueRequirements(prdMd, l.issues.map((i) => i.key));
  for (const i of l.issues) {
    i.requirements = reqs.get(i.key) ?? [];
    const why = notTakenReason(prdMd, i.key);
    if (!i.released && why && !i.requirements.length) i.released = { at: now(), reason: why };
  }
}

/** After the PRD is approved: one comment on each issue saying which plan took it and how. */
export function onPrdApproved(pc: PlanCtx, s: State, prdMd: string): void {
  const l = s.linear;
  if (!l) return;
  recordRequirements(s, prdMd);
  const prd = `${planRelOf(pc.plan)}/prd.md`;
  for (const i of l.issues) {
    if (i.released) queueComment(l, i.key, `Not taken by cairn plan "${s.title}" (\`${s.branch}\`): ${i.released.reason}`, `${i.key} is left out of the plan`, 'released');
    else if (i.requirements?.length)
      queueComment(l, i.key, `cairn plan "${s.title}" (\`${s.branch}\`) takes this issue as ${i.requirements.join(', ')}. PRD: \`${prd}\`.`, `${i.key} is in the approved PRD`, 'prd');
  }
}

/** Moves between stages: In Progress at execute, In Review and the PR link at ship, follow-ups and a project update at close. */
export function onAdvance(pc: PlanCtx, s: State, from: State['stage'], to: State['stage'], opts: Opts, followups?: FollowupInfo[]): void {
  const l = s.linear;
  if (!l) return;
  const cfg = linearConfig(pc.cfg);
  const taken = takenIssues(l);
  if (to === 'execute') {
    // A plan with one ticket per task moves only its epics now; each ticket moves when its own first task starts
    // (syncTickets). An older plan, loaded before tasks named their ticket, moves every issue together as before.
    const parents = parentKeys(taken);
    const perTicket = hasTicketTasks(s);
    for (const i of taken) if ((!perTicket || parents.has(i.key)) && !isDone(i) && i.stateType !== 'started') queueStatus(l, cfg, i.key, 'inProgress', perTicket ? 'the plan started building this epic' : 'the plan started building');
    if (l.epic && !taken.some((i) => i.key === l.epic)) {
      const epic = l.known.find((i) => i.key === l.epic);
      if (!isDone(epic) && epic?.stateType !== 'started') queueStatus(l, cfg, l.epic, 'inProgress', 'a plan started building part of this epic');
    }
    syncTickets(s, cfg);
  }
  if (from === 'ship' && (to === 'learn' || to === 'closed')) {
    if (typeof opts.pr === 'string' && opts.pr.trim()) l.pr = opts.pr.trim();
    const progress = issueProgress(s);
    const parents = parentKeys(taken);
    for (const i of taken) {
      if (parents.has(i.key) || progress.get(i.key) !== 'shipped') continue;
      const review = queueStatus(l, cfg, i.key, 'inReview', 'the pull request is open');
      queueComment(l, i.key, `Shipped by cairn plan "${s.title}" (\`${s.branch}\`)${l.pr ? `: ${l.pr}` : '; the pull request is open'}.${review ? '' : ' Waiting on review and merge.'}`, `${i.key} is in an open pull request`, 'pr');
    }
    // The epic's own comment, so it reads without opening each child.
    for (const p of new Set([...parents, ...(l.epic ? [l.epic] : [])])) {
      const kids = [...l.issues, ...l.known].filter((i) => i.parent === p);
      const done = kids.filter((k) => isDone(k) || progress.get(k.key) === 'shipped').length;
      if (kids.length) queueComment(l, p, `${done} of ${kids.length} sub-issues shipped (plan \`${s.branch}\`${l.pr ? `, ${l.pr}` : ''}).`, `progress on ${p}`, `epic:${s.slug}`);
    }
  }
  if (to === 'closed') onClose(pc, s, followups ?? []);
}

export interface FollowupInfo {
  key: string;
  text: string;
  area: string;
  hardening: boolean;
  linear?: string;
}

/** The plan's open follow-ups, read before the state lock (they span every plan). */
export function followupsFor(pc: PlanCtx, slug: string): FollowupInfo[] {
  try {
    return collectSuggestions(pc.ctx)
      .filter((x) => x.open && x.slug === slug)
      .map((x) => ({ key: x.key, text: x.text, area: x.area, hardening: x.hardening, ...(x.linear ? { linear: x.linear } : {}) }));
  } catch {
    return [];
  }
}

/** Which open follow-ups a close files in Linear, and how many hardening items stay in cairn. */
export function followupsToFile(mode: 'ordinary' | 'all' | 'none' | undefined, followups: FollowupInfo[]): { filed: FollowupInfo[]; keptHardening: number } {
  const m = mode ?? 'ordinary';
  const filed = m === 'none' ? [] : m === 'all' ? followups : followups.filter((f) => !f.hardening);
  return { filed, keptHardening: m === 'all' ? 0 : followups.filter((f) => f.hardening && !f.linear).length };
}

function onClose(pc: PlanCtx, s: State, followups: FollowupInfo[]): void {
  const l = s.linear!;
  const taken = takenIssues(l);
  // Hardening items stay in cairn by default, where a later plan on the same files is offered them; Linear gets the ordinary ones.
  const { filed, keptHardening } = followupsToFile(linearConfig(pc.cfg)?.fileFollowUps, followups);
  for (const f of filed) {
    if (f.linear) continue;
    queueWrite(l, {
      kind: 'createIssue',
      target: f.key,
      payload: {
        team: l.team,
        title: f.text.split('\n')[0].slice(0, 120),
        description: `${f.text}\n\nFollow-up from cairn plan "${s.title}" (\`${s.branch}\`), ${f.hardening ? 'hardening' : f.area}.`,
        ...(l.project ? { project: l.project } : {}),
        ...(l.milestone ? { milestone: l.milestone } : {}),
        labels: ['cairn-follow-up'],
      },
      why: `open follow-up ${f.key}`,
      dedupe: `create:${f.key}`,
    });
  }
  if (l.project) {
    const left = l.issues.filter((i) => i.released);
    const body = [
      `**${s.title}** is closed${l.pr ? ` (${l.pr})` : ''}.`,
      `Built: ${taken.map((i) => `${i.key} ${i.title}`).join('; ') || 'nothing from Linear'}.`,
      ...(left.length ? [`Left for later: ${left.map((i) => `${i.key} (${i.released!.reason})`).join('; ')}.`] : []),
      ...(filed.filter((f) => !f.linear).length ? [`Follow-ups filed: ${filed.filter((f) => !f.linear).length}.`] : []),
      ...(keptHardening ? [`${keptHardening} hardening item${keptHardening === 1 ? '' : 's'} left in cairn.`] : []),
    ].join('\n\n');
    queueWrite(l, { kind: 'statusUpdate', target: l.project, payload: { type: 'project', project: l.project, health: 'onTrack', body }, why: `project update for "${l.project}"`, dedupe: `update:${s.slug}`, needsApproval: true });
  }
}

/**
 * Each ticket's status follows its own tasks: In Progress when its first task starts, In Review (with a comment) once
 * every task of it is in review or done. Done comes at merge. Called after every task move and phase finish.
 */
export function syncTickets(s: State, cfg: LinearConfig | undefined): void {
  const l = s.linear;
  // Plans loaded before tasks named their ticket share requirements across tickets: they keep the phase-end comment.
  if (!l || s.stage !== 'execute' || !hasTicketTasks(s)) return;
  const progress = issueProgress(s);
  const taken = takenIssues(l);
  const parents = parentKeys(taken);
  const hasReview = !!statusFor(cfg, 'inReview');
  for (const i of taken) {
    if (parents.has(i.key) || isDone(i)) continue;
    const p = progress.get(i.key);
    const review = p === 'in review' || p === 'built';
    const reviewQueued = l.outbox.some((w) => w.dedupe === `status:${i.key}:inReview`);
    if ((p === 'in progress' || (review && !hasReview)) && i.stateType !== 'started' && !reviewQueued) queueStatus(l, cfg, i.key, 'inProgress', `work on ${i.key} started`);
    if (review) {
      queueStatus(l, cfg, i.key, 'inReview', `every task of ${i.key} is built and in review`);
      queueComment(l, i.key, `In review in cairn plan "${s.title}" (\`${s.branch}\`): its tasks are built and cairn is checking them. It is done when the pull request merges.`, `${i.key} is in review`, 'review');
    }
  }
}

/** After a phase finishes: the per-ticket moves, in case a task's last step was missed; an older plan gets a comment on each issue now built. */
export function onPhaseFinished(s: State, cfg: LinearConfig | undefined): void {
  const l = s.linear;
  if (!l) return;
  if (hasTicketTasks(s)) return syncTickets(s, cfg);
  const progress = issueProgress(s);
  for (const i of takenIssues(l))
    if (progress.get(i.key) === 'built') queueComment(l, i.key, `Built in cairn plan "${s.title}" (\`${s.branch}\`); checks and review come next.`, `${i.key} is built`, 'built');
}

/** Refresh changes the plan hasn't decided about yet: they hold up `phase finish`. */
export function linearPhaseGate(s: State, opts: Opts): void {
  const open = s.linear?.changes.filter((c) => !c.handled) ?? [];
  gate(!open.length, s, 'phase finish', opts, `changes in Linear are not handled yet: ${open.map((c) => `${c.id} ${changeText(c)}`).join('; ')}`, [
    'cairn linear depends <KEY> --on <KEY> --reason "…" (a real dependency)',
    'cairn linear ack <id> --as taken|later|noted [--note "…"]',
    'cairn linear release <KEY> --reason "…" (drop the blocked issue)',
  ]);
}

/** After a re-plan loads, a new link between two in-plan issues is covered by the order check: mark it handled. */
export function onPlanLoaded(s: State): void {
  const l = s.linear;
  if (!l) return;
  const inPlan = new Set(takenIssues(l).map((i) => i.key));
  for (const c of l.changes) if (!c.handled && c.kind === 'link' && inPlan.has(c.key) && inPlan.has(c.on!)) c.handled = { at: now(), how: 'replan' };
}

/** Before `approve ship`: blockers this plan's issues have in other plans must have shipped. Read before the lock. */
export function crossPlanBlockers(ctx: Ctx, s: State): string[] {
  const stack = stackedOnBlocker(ctx, s);
  const l = s.linear;
  if (!l) return stack;
  const others = otherPlans(ctx, s.slug);
  const byKey = new Map([...l.known, ...l.issues].map((i) => [i.key, i]));
  const inPlan = new Set(takenIssues(l).map((i) => i.key));
  const out: string[] = [];
  for (const i of takenIssues(l))
    for (const b of effectiveBlockers(i, byKey, l.depends)) {
      if (inPlan.has(b) || isDone(byKey.get(b))) continue;
      const o = ownerOf(others, b);
      if (!o) continue;
      // A plan closes before its pull request merges: only a merged branch counts as shipped.
      if (o.stage !== 'learn' && o.stage !== 'closed') out.push(`${i.key} needs ${b}, which plan ${o.slug} has not shipped (it is in ${o.stage})`);
      else if (!merged(ctx, o.state)) out.push(`${i.key} needs ${b}, which plan ${o.slug} has not merged yet`);
    }
  return [...new Set([...stack, ...out])];
}

/** A plan started with `--after` ships only once the plan it stacked on has merged: until then its branch carries that plan's work. */
function stackedOnBlocker(ctx: Ctx, s: State): string[] {
  if (!s.stackedOn) return [];
  const row = stackBase(ctx, s.stackedOn.slug);
  if (stackLanded(ctx, s.stackedOn, row, ctx.top)) return [];
  return [row ? `it is stacked on plan ${row.state.slug}, which has not merged yet (it is in ${row.state.stage})` : `it is stacked on plan ${s.stackedOn.slug}, whose branch cannot be read and whose work is not on the main branch, so it is not known to have merged`];
}

/**
 * Whether the plan a stacked plan sits on has landed. Its plan row says so when it can be read. Otherwise (branch
 * deleted, or kept on the remote only) the base tip recorded in `stackedOn` must be in the main branch, or the base's
 * pull request must show as merged. A base branch that is merely gone never counts: it may have been abandoned.
 * Reads the refs as they are (no fetch), so a stale main only delays the answer.
 */
export function stackLanded(ctx: Ctx, st: NonNullable<State['stackedOn']>, row: ReturnType<typeof stackBase>, cwd: string): boolean {
  if (row && merged(ctx, row.state)) return true;
  const target = row?.state.base ?? ctx.worktrees[0]?.branch ?? 'main';
  if (st.tip && safeRef(cwd, target)) {
    const inTarget = (sha: string) => [target, `origin/${target}`].some((r) => gitOk(['rev-parse', '--verify', '--quiet', `${r}^{commit}`], cwd) && gitOk(['merge-base', '--is-ancestor', sha, r], cwd));
    const heads = [st.branch, `origin/${st.branch}`].map((r) => gitTry(['rev-parse', '--verify', '--quiet', `${r}^{commit}`], cwd)).filter((r) => r.ok).map((r) => r.out.trim());
    if (inTarget(st.tip) && heads.every(inTarget)) return true;
  }
  return prMerged(cwd, st.branch, join(commonDir(ctx.mainRoot), PR_CACHE));
}

/** Whether another plan's branch has landed in its base. Its state came from another branch, so its refs are checked first (`mergeState` does). */
export function merged(ctx: Ctx, s: State): boolean {
  try {
    const rel = resolvePlanDir(s.slug, { ref: s.branch, cwd: ctx.top }) ?? '';
    return landedState(ctx.top, s.branch, s.base, rel, join(commonDir(ctx.mainRoot), PR_CACHE)) === 'merged';
  } catch {
    return false;
  }
}

// ---------- Status and board ----------

function linearStatus(ctx: Ctx): Result {
  const pc = planCtx(ctx);
  const s = loadState(pc.plan.dir);
  const l = linkOf(s);
  const progress = issueProgress(s);
  const open = l.changes.filter((c) => !c.handled);
  const foundational = isFoundational(l, linearConfig(pc.cfg));
  // The issue text files that exist, by key: read them for the descriptions.
  const texts = Object.fromEntries(l.issues.filter((i) => existsSync(join(pc.plan.dir, 'issues', `${i.key}.md`))).map((i) => [i.key, issueTextPath(pc, i.key)]));
  const lines = [
    `Linear: ${[l.project, l.milestone, l.epic ? `epic ${l.epic}` : undefined].filter(Boolean).join(' · ') || l.team}`,
    ...(foundational ? [`Foundational: the plan names its approach and the ones it rejected (## Approaches considered), and the user approves it with the plan.`] : []),
    ...l.issues.map((i) => `  ${i.key} ${i.title}: ${progress.get(i.key)}${i.released ? ` (${i.released.reason})` : ''}${i.requirements?.length ? ` [${i.requirements.join(', ')}]` : ''}${i.labels?.length ? ` · labels: ${i.labels.join(', ')}` : ''}${texts[i.key] ? ` · text: ${texts[i.key]}` : ''}`),
    ...(open.length ? [`Changes to decide: ${open.map((c) => `${c.id} ${changeText(c)}`).join('; ')}`] : []),
    ...(unsent(l).length ? [`${unsent(l).length} update(s) waiting to be sent: cairn linear pending`] : []),
  ];
  return { message: lines.join('\n'), data: { linear: l, progress: Object.fromEntries(progress), openChanges: open, pending: unsent(l).length, foundational, texts } };
}

const projectSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
const snapshotDir = (ctx: Ctx) => join(commonDir(ctx.mainRoot), 'cairn', 'linear');
const snapshotFile = (ctx: Ctx, project: string) => join(snapshotDir(ctx), `${projectSlug(project)}.json`);

function loadSnapshot(ctx: Ctx, project?: string): BoardSnapshot {
  const dir = snapshotDir(ctx);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  const read = (f: string) => JSON.parse(readText(join(dir, f)) ?? '{}') as BoardSnapshot;
  if (project) {
    const f = `${projectSlug(project)}.json`;
    if (!files.includes(f)) throw new Refusal(`no snapshot of "${project}" yet`, [`read it from Linear first: /cairn:board ${project}`]);
    return read(f);
  }
  if (files.length === 1) return read(files[0]);
  if (!files.length) throw new Refusal('no Linear project has been read yet', ['/cairn:board <project> reads one from Linear']);
  throw new Refusal(`several projects have been read: ${files.map((f) => f.replace(/\.json$/, '')).join(', ')}`, ['pass --project "<name>"']);
}

/** After this many days, the board suggests reading every link again. */
const FULL_READ_DAYS = 3;

const blockedText = (x: BoardIssue) => `blocked by ${x.blockedBy.map((b) => (b.where ? `${b.key} [${b.where}]` : b.key)).join(', ')}`;

/** `alongside SAV-16 (plan sav-16-repo-ci-observability, verify)`, one entry per plan. */
const alongsideText = (after: { key: string; slug: string; stage: string }[]) =>
  `alongside ${after.map((a) => `${a.key} (plan ${a.slug}, ${a.stage})`).join(', ')}`;

const issueLine = (x: BoardIssue, indent: string) =>
  `${indent}${x.status === 'done' ? '✓' : x.status === 'in plan' ? '▸' : x.status === 'ready' ? '○' : x.status === 'alongside' ? '⇉' : '✗'} ${x.key} ${x.title}${x.plan ? `: ${x.plan.slug} (${x.plan.stage}, ${x.plan.progress})` : ''}${x.status === 'blocked' ? `: ${blockedText(x)}` : ''}${x.status === 'alongside' ? `: ${alongsideText(x.after ?? [])}` : ''}`;

function board(ctx: Ctx, opts: Opts): Result {
  const snap = loadSnapshot(ctx, typeof opts.project === 'string' ? opts.project : undefined);
  const plans = otherPlans(ctx);
  const data = buildBoard({ snap, plans, progress: new Map(plans.map((p) => [p.slug, issueProgress(p.state)])) });
  const ageMinutes = Math.max(0, Math.round((Date.now() - Date.parse(snap.readAt)) / 60_000));
  const age = ageMinutes < 60 ? `${ageMinutes} min` : ageMinutes < 2880 ? `${Math.round(ageMinutes / 60)} h` : `${Math.round(ageMinutes / 1440)} days`;
  // Incremental reads trust Linear's change time; a link change may not move it, so an old full read is worth redoing.
  const fullReadDays = snap.fullReadAt ? Math.floor((Date.now() - Date.parse(snap.fullReadAt)) / 86_400_000) : null;
  const fullHint =
    fullReadDays === null
      ? `No full read of the links yet: /cairn:board ${snap.project} --full reads every open issue's links once.`
      : fullReadDays > FULL_READ_DAYS
        ? `Last full read of the links was ${fullReadDays} days ago: /cairn:board ${snap.project} --full reads them all again.`
        : undefined;
  const header = `${snap.project}: read from Linear ${age} ago.`;
  const extra = { project: snap.project, readAt: snap.readAt, ageMinutes, fullReadAt: snap.fullReadAt ?? null, fullReadDays };

  const epicKey = typeof opts.epic === 'string' ? opts.epic.trim().toUpperCase() : undefined;
  if (epicKey) {
    const byKey = new Map(snap.issues.map((i) => [i.key, i]));
    const isEpic = byKey.has(epicKey) && snap.issues.some((i) => i.parent === epicKey);
    if (!isEpic) throw new Refusal(`${epicKey} is not an epic in "${snap.project}" as last read`, ['cairn linear board lists the epics', `or re-read the project: /cairn:board ${snap.project}`]);
    const inside = (k: string) => {
      for (let p = byKey.get(k)?.parent, n = 0; p && n < 50; p = byKey.get(p)?.parent, n++) if (p === epicKey) return true;
      return false;
    };
    const every = data.milestones.flatMap((m) => [...m.epics.flatMap((e) => e.issues), ...m.issues]);
    const kids = every.filter((x) => inside(x.key));
    const top = data.milestones.flatMap((m) => m.epics).find((e) => e.key === epicKey);
    const epic = top ?? { key: epicKey, title: byKey.get(epicKey)!.title, done: kids.filter((k) => k.status === 'done').length, total: kids.length, plans: [...new Set(kids.map((k) => k.plan?.slug).filter((x): x is string => !!x))], issues: kids };
    const counts = { total: kids.length, done: epic.done, inPlan: kids.filter((x) => x.status === 'in plan').length, ready: kids.filter((x) => x.status === 'ready').length, alongside: kids.filter((x) => x.status === 'alongside').length, blocked: kids.filter((x) => x.status === 'blocked').length };
    const milestones = [{ name: byKey.get(epicKey)!.milestone ?? 'No milestone', counts, epics: [epic], issues: [] as BoardIssue[] }];
    const lines = [header, `${milestones[0].name}: ${counts.done}/${counts.total} done, ${counts.inPlan} in a plan, ${counts.ready} ready, ${counts.alongside} alongside, ${counts.blocked} blocked`, `  epic ${epic.key} ${epic.title}: ${epic.done}/${epic.total} done${epic.plans.length ? `, plans: ${epic.plans.join(', ')}` : ''}`, ...epic.issues.map((x) => issueLine(x, '    '))];
    return { message: lines.join('\n'), data: { ...data, ...extra, milestones } };
  }

  const all = data.milestones.flatMap((m) => [...m.epics.flatMap((e) => e.issues), ...m.issues]);
  const issueOf = new Map(all.map((x) => [x.key, x]));
  const focusAt = data.focus === null ? data.milestones.length : data.milestones.findIndex((m) => m.name === data.focus);
  const upTo = data.milestones.slice(0, data.focus === null ? focusAt : focusAt + 1);
  const later = data.milestones.slice(focusAt + 1);
  const lines: string[] = [header];
  for (const m of upTo) lines.push(m.name === data.focus ? `${m.name}: ${m.counts.done}/${m.counts.total} done` : `✓ ${m.name}`);

  if (data.inProgress.length) {
    lines.push('In progress:');
    for (const p of data.inProgress) {
      lines.push(`  ${p.title ?? p.slug} (plan ${p.slug}, ${p.stage}): ${p.done}/${p.total} done`);
      for (const i of p.issues) lines.push(`    ${i.key} ${i.title}: ${i.progress}`);
    }
  }
  if (data.ready.length) {
    lines.push('Ready to start:');
    for (const r of data.ready) lines.push(`  ${r.key} ${r.title}${r.unblocks > 0 ? `, unblocks ${r.unblocks}` : ''}${r.milestone !== data.focus ? ` [${r.milestone}]` : ''}${r.kind === 'epic' ? ` (/cairn:new --from-linear ${r.key})` : ''}`);
  }
  if (data.alongside.length) {
    lines.push('Can start alongside:');
    for (const r of data.alongside) lines.push(`  ${r.key} ${r.title} ${alongsideText(r.after)}${r.unblocks > 0 ? `, unblocks ${r.unblocks}` : ''}${r.milestone !== data.focus ? ` [${r.milestone}]` : ''}${r.kind === 'epic' ? ` (/cairn:new --from-linear ${r.key})` : ''}`);
  }
  if (data.waiting.length) {
    lines.push('Waiting:');
    for (const w of data.waiting) {
      const x = w.kind === 'issue' ? issueOf.get(w.key) : undefined;
      const on = w.waitsOn.length ? `, waits on ${w.waitsOn.join(', ')}` : ', waits on its own issues';
      lines.push(`  ${w.key} ${w.title}${w.kind === 'epic' ? ` ${w.done}/${w.total}${on}` : x ? `, ${blockedText(x)}` : on}`);
    }
  }
  lines.push(`Done: ${data.done} ${data.done === 1 ? 'issue' : 'issues'}`);
  for (const m of later) lines.push(`${m.name}: ${m.counts.done}/${m.counts.total} done${m.waitsOn?.length ? `, waits on ${m.waitsOn.join(', ')}` : ''}`);

  for (const p of data.plans.filter((p) => p.stalled)) lines.push(`Plan ${p.slug} (${p.stage}) has had no change in over a week.`);
  for (const w of data.wideLinks) lines.push(`${w.epic}'s blocked-by link to ${w.on} makes all ${w.holds} of its open issues wait. Link only the sub-issues that need ${w.on}.`);
  if (data.cycle) lines.push(`Loop in blocked-by links: ${data.cycle.join(' → ')}. Remove one link in Linear.`);
  if (fullHint) lines.push(fullHint);
  return { message: lines.join('\n'), data: { ...data, ...extra } };
}

// ---------- Relink: narrowing an epic's own blocked-by link ----------

interface RelinkIssue {
  key: string;
  title: string;
  state: string;
  /** Path of the saved issue text (`issues/<KEY>.md` in a plan folder), when one exists. */
  text?: string;
}

/** What an agent needs to move an epic's blocked-by link down to the sub-issues that need it. Never writes to Linear or the snapshot. */
function relink(ctx: Ctx, arg: string | undefined, opts: Opts): Result {
  const epicKey = arg?.trim().toUpperCase();
  if (!epicKey) throw new CliError(USAGE);
  const snap = loadSnapshot(ctx, typeof opts.project === 'string' ? opts.project : undefined);
  const byKey = new Map([...(snap.known ?? []), ...snap.issues].map((i) => [i.key, i]));
  const epic = snap.issues.find((i) => i.key === epicKey);
  const subsOf = (k: string) => snap.issues.filter((i) => i.parent === k && !isDone(i));
  if (!epic || !snap.issues.some((i) => i.parent === epicKey))
    throw new Refusal(`${epicKey} is not an epic in "${snap.project}" as last read`, ['cairn linear board lists the epics', `or re-read the project: /cairn:board ${snap.project}`]);
  if (!epic.blockedBy.length) throw new Refusal(`${epicKey} has no blocked-by link of its own`, ['only a link on the epic itself can be narrowed; sub-issues already carry theirs']);

  let dirs: string[] = [];
  try {
    dirs = listPlans(ctx).map((r) => r.dir);
  } catch {
    // No plans to read texts from: the texts come from Linear.
  }
  const textOf = (k: string): string | undefined => dirs.map((d) => join(d, 'issues', `${k}.md`)).find((f) => existsSync(f));
  const row = (i: LinearIssue): RelinkIssue => {
    const text = textOf(i.key);
    return { key: i.key, title: i.title, state: i.stateName ?? i.stateType ?? 'unknown', ...(text ? { text } : {}) };
  };

  const links = epic.blockedBy.map((on) => {
    const b = byKey.get(on);
    const text = textOf(on);
    return {
      on,
      blocker: { key: on, title: b?.title ?? on, isEpic: snap.issues.some((i) => i.parent === on), ...(text ? { text } : {}) },
      blockerSubs: subsOf(on).map(row),
      subs: subsOf(epicKey).map((i) => ({ ...row(i), blockedBy: i.blockedBy })),
    };
  });

  const lines = [`${epicKey} ${epic.title}: ${links.length === 1 ? 'one blocked-by link' : `${links.length} blocked-by links`} of its own.`];
  for (const l of links) {
    lines.push(`Blocked by ${l.on} ${l.blocker.title}${l.blocker.isEpic ? ` (epic, ${l.blockerSubs.length} open sub-issues)` : ''}:`);
    if (l.blocker.isEpic) for (const x of l.blockerSubs) lines.push(`  ${x.key} ${x.title} [${x.state}]${x.text ? ` · text: ${x.text}` : ''}`);
    lines.push(`${epicKey}'s open sub-issues (${l.subs.length}):`);
    for (const x of l.subs) lines.push(`  ${x.key} ${x.title} [${x.state}]${x.blockedBy.length ? ` · blocked by ${x.blockedBy.join(', ')}` : ''}${x.text ? ` · text: ${x.text}` : ''}`);
  }
  if (links.some((l) => [...l.subs, ...l.blockerSubs].some((x) => !x.text))) lines.push('Issues without a text file: read their descriptions with get_issue.');
  const epicText = textOf(epicKey);
  return { message: lines.join('\n'), data: { epic: { key: epicKey, title: epic.title, ...(epicText ? { text: epicText } : {}) }, links } };
}

/**
 * Plans whose branch merged while nobody ran cairn in their worktree, so their Done statuses were never queued.
 * `cairn next` on main points at the first; it may ask `gh`, so a hook never calls this.
 */
export function mergedPlansAwaitingDone(ctx: Ctx): { slug: string; worktree: string }[] {
  try {
    return listPlans(ctx)
      .filter((r) => r.worktree && wellFormed(r.state.linear) && (r.state.stage === 'learn' || r.state.stage === 'closed') && !doneQueued(r.state.linear) && merged(ctx, r.state))
      .map((r) => ({ slug: r.state.slug, worktree: r.worktree! }));
  } catch {
    return [];
  }
}

/** For the session-start hook: the count only, no git or network. */
export const pendingCount = (s: State): number => due(s.linear).length;
