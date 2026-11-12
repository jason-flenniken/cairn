export const STAGES = ['repro', 'discover', 'prd', 'plan', 'execute', 'verify', 'review', 'ship', 'learn', 'closed'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  repro: 'Repro',
  discover: 'Discover',
  prd: 'PRD',
  plan: 'Plan',
  execute: 'Build',
  verify: 'Check',
  review: 'Review',
  ship: 'Ship',
  learn: 'Learn',
  closed: 'Closed',
};
/** The steps `cairn step` can record, by stage. The fix track uses review and ship. */
export const STEPS: Partial<Record<Stage, readonly string[]>> = {
  prd: ['drafting', 'checking', 'approving'],
  plan: ['drafting', 'checking', 'approving'],
  verify: ['testing', 'scanning', 'fixing'],
  review: ['reviewing', 'fixing', 'rechecking'],
  ship: ['recording', 'approving', 'opening-pr'],
};
export const STEP_LABEL: Record<string, string> = {
  drafting: 'drafting',
  checking: 'builder check',
  recording: 'writing the record',
  testing: 'running tests',
  scanning: 'scanning for secrets',
  fixing: 'fixing',
  reviewing: 'reviewing',
  rechecking: 're-checking',
  approving: 'waiting on approval',
  'opening-pr': 'opening the PR',
};
export interface Step {
  stage: Stage;
  name: string;
  count?: number;
  at: string;
}
export type Track = 'feature' | 'fix';
export const LEVELS = ['mvp', 'standard', 'polished'] as const;
export type Level = (typeof LEVELS)[number];
export const isLevel = (v: unknown): v is Level => (LEVELS as readonly unknown[]).includes(v);
export const LEVEL_LABEL: Record<Level, string> = { mvp: 'MVP', standard: 'Standard', polished: 'Polished' };
export type Complexity = 'simple' | 'standard' | 'complex';
export type TaskStatus = 'pending' | 'in_progress' | 'done';
export const SUBSTEPS = ['implementing', 'reviewing', 'fixing', 'merging', 'blocked'] as const;
export type Substep = (typeof SUBSTEPS)[number];
export type PhaseStatus = 'pending' | 'in_progress' | 'awaiting_approval' | 'done';

export interface Approval {
  at: string;
  via: 'agent' | 'human';
  note?: string;
  hash?: string;
  source?: 'mod' | 'terminal' | 'agent';
  /** Ship only: the plan branch's HEAD when it was approved. Code committed after it needs the approval again. */
  sha?: string;
}

export interface Task {
  id: string;
  name: string;
  /** `prefactor` tasks prepare the code and may cover no requirement. */
  kind?: 'prefactor';
  covers: string[];
  /** The Linear ticket this task builds, set at plan load from the requirements it covers (or the plan's epic). */
  issue?: string;
  /** A plan with no Linear tickets yet: the ticket this task goes under when the plan is put in Linear (`ticket:` in plan.md). */
  ticket?: string;
  blockedBy: string[];
  scope: string[];
  complexity: Complexity;
  status: TaskStatus;
  substep?: Substep;
  fixRound: number;
  note?: string;
  branch?: string;
  worktree?: string;
  /** Plan-branch commit the task started from. */
  base?: string;
  tip?: string;
  tests?: string;
  /** Plan-branch commit the task's recorded test run was made at. */
  testedCommit?: string;
  doneAt?: string;
  /** ISO time the task first started; kept on resume. */
  startedAt?: string;
  /** The plan's level when the task first started. */
  level?: Level;
  /** Risky tasks (auth, money, deletes data, migrations, public API) get TDD and a reviewer. */
  risky?: boolean;
  riskReason?: string;
}

export interface Phase {
  id: string;
  name: string;
  status: PhaseStatus;
  tasks: Task[];
  verdict?: { result: 'green' | 'yellow' | 'red'; at: string; commit: string; note?: string };
}

export interface Evidence {
  result: 'pass' | 'fail';
  at: string;
  note?: string;
  blocking?: number;
}

export interface DriftEntry {
  path: string;
  at: string;
  reason: string;
  task?: string;
  acked?: { at: string; note?: string };
}

export const SUGGESTION_AREAS = ['tests', 'security', 'perf', 'quality', 'ux', 'docs'] as const;
export const SUGGESTION_SOURCES = ['task-review', 'branch-review', 'check', 'implementer', 'plan', 'user', 'mvp', 'security-review'] as const;

/** A recommended piece of future quality work. A suggestion with `resolves` closes another one. */
export interface Suggestion {
  id: string;
  area: (typeof SUGGESTION_AREAS)[number];
  text: string;
  where: string[];
  from: (typeof SUGGESTION_SOURCES)[number];
  at: string;
  /** `<slug>:<id>` of the suggestion this entry closes. */
  resolves?: string;
  /** `<slug>:<id>` of a suggestion this entry records one decline of. */
  declines?: string;
  /** `<slug>:<id>` of the suggestions this entry groups into one; they count as merged. */
  merges?: string[];
  dismissed?: boolean;
  note?: string;
  /** A hardening item is a follow-up an MVP plan leaves behind: it skips the close cap, the open count and expiry. */
  kind?: 'hardening';
  /** The test command a failing-suite hardening item is about; at most one stays open per command. */
  testCmd?: string;
  /** The Linear issue this follow-up was filed as, once sent. */
  linear?: string;
}

export interface LogEntry {
  at: string;
  event: string;
  detail?: string;
  override?: string;
}

export interface State {
  schema: 1;
  slug: string;
  title: string;
  track: Track;
  /** Feature plans only. Read through `levelOf`; absent reads as Standard. */
  level?: Level;
  /** The cairn version that created the plan. */
  cairnVersion?: string;
  branch: string;
  base: string;
  created: string;
  updated: string;
  stage: Stage;
  /** Every stage entry, oldest first. Plans made before this field have none. */
  stageHistory?: { stage: Stage; at: string }[];
  paused: { at: string; mode: 'drain' | 'now'; handoffHash?: string } | null;
  approvals: { prd?: Approval; plan?: Approval; ship?: Approval };
  /** Set by `cairn merge-check` when code changed after the ship approval: the ship needs approving again. */
  reapprove?: { at: string; why: string };
  /** Merges of the base that `cairn merge-check` made itself, cleanly: commits it can vouch for after the approval. */
  baseMerges?: string[];
  /** Set by `cairn new --after`: the plan whose branch this one started on. `cairn restack` clears it once that plan has merged. */
  stackedOn?: { slug: string; branch: string };
  /** The last head `cairn merge-check` saw the tests pass on. Only plan-folder commits since it skip the tests. */
  mergeChecked?: string;
  planHash?: string;
  /** What the check, review or ship stage is doing now. Cleared when the stage changes. */
  step?: Step;
  repro?: { cmd: string; tail: string; at: string };
  configHash?: string;
  phases: Phase[];
  evidence: { verify?: Evidence; review?: Evidence };
  drift: DriftEntry[];
  suggestions?: Suggestion[];
  /** Present only on plans that pulled Linear issues in (`cairn linear import`). */
  linear?: LinearLink;
  log: LogEntry[];
}

/** Linear status types (a team's statuses each have one). */
export const LINEAR_DONE_TYPES = ['completed', 'canceled', 'duplicate'] as const;

/** One Linear issue a plan pulled in, or one it knows about through a link. */
export interface LinearIssue {
  key: string;
  title: string;
  url?: string;
  /** The issue's status type in Linear when last read: backlog, unstarted, started, completed, canceled. */
  stateType?: string;
  stateName?: string;
  milestone?: string;
  /** Key of the parent issue, when this is a sub-issue. */
  parent?: string;
  /** Keys of issues that block this one, in Linear. */
  blockedBy: string[];
  /** Label names, as last read. */
  labels?: string[];
  /** Hash of the description last written to `issues/<KEY>.md`: a change after the PRD approval is noted on refresh. */
  descriptionHash?: string;
  /** Linear's last-change time, as last read (board snapshots). */
  updatedAt?: string;
  /** FR ids tagged with this key in the PRD, recorded when the PRD is approved. */
  requirements?: string[];
  /** Left out of the plan: the PRD lists it under `## Issues not taken`, or `cairn linear release` dropped it. */
  released?: { at: string; reason: string };
}

export type LinearWriteKind = 'status' | 'comment' | 'relation' | 'statusUpdate' | 'createIssue';

/** A write to Linear that cairn queued and the agent sends through the Linear MCP. */
export interface LinearWrite {
  id: string;
  kind: LinearWriteKind;
  /** Issue key (status, comment, relation), project name (statusUpdate), or suggestion key (createIssue). */
  target: string;
  /** The parameters for the Linear tool, ready to pass as-is. */
  payload: Record<string, unknown>;
  /** What this write is for, in one line, for the person reading the queue. */
  why: string;
  /** Same dedupe key, same write: queueing it again is a no-op. */
  dedupe: string;
  /** The user approves it before it is sent (project status updates). */
  needsApproval?: boolean;
  queuedAt: string;
  sentAt?: string;
  /** What Linear returned: a new issue key, a comment url. */
  ref?: string;
  /** `cairn linear publish`: the epic, or one ticket of the plan, that this createIssue files. */
  publish?: { role: 'epic' | 'ticket'; ticket?: string };
  dropped?: { at: string; note: string };
  /** Tried and not sent (the send failed, no Linear tools, or the user held it): retried at the next sync, but `cairn next` doesn't route for it alone. */
  held?: { at: string; note: string };
}

/** A change seen on refresh that the plan has to decide about before its phase can finish. */
export interface LinearChange {
  id: string;
  kind: 'link' | 'sub-issue';
  /** The in-plan issue the change touches. */
  key: string;
  /** For a link: the blocker. */
  on?: string;
  /** For a new sub-issue: the issue as Linear has it. */
  issue?: LinearIssue;
  at: string;
  handled?: { at: string; how: 'depends' | 'taken' | 'later' | 'noted' | 'replan' | 'released'; note?: string };
}

export interface LinearLink {
  team: string;
  project?: string;
  milestone?: string;
  /** Key of the parent issue whose sub-issues the plan works through. */
  epic?: string;
  /** How the plan picked its issues, as the user gave it ("SAV-100", "milestone:M1"). */
  selection?: string;
  issues: LinearIssue[];
  /** Issues outside the plan that in-plan issues reference (blockers, an epic's other sub-issues), as last read. */
  known: LinearIssue[];
  importedAt: string;
  refreshedAt?: string;
  /** Dependencies found while building, recorded with `cairn linear depends`. */
  depends: { key: string; on: string; reason: string; at: string }[];
  changes: LinearChange[];
  outbox: LinearWrite[];
  /** The pull request url, given to `cairn advance --pr` when the plan moves past ship. */
  pr?: string;
  /** When cairn first saw the plan's branch merged and queued the Done statuses. */
  mergedAt?: string;
}

export interface Config {
  /** Run in every new plan and task worktree (e.g. install dependencies). CAIRN_MAIN_ROOT is set. */
  setup?: string;
  test?: string;
  build?: string;
  start?: string;
  seed?: string;
  appTypes?: string[];
  maxParallel: number;
  autoCommit: boolean;
  worktreeRoot?: string;
  resumeFreshAfterMinutes?: number;
  fixMaxFiles?: number;
  reproTimeoutMinutes?: number;
  /** The level `/cairn:new` pre-selects: mvp, standard or polished. Standard when unset. */
  defaultLevel?: string;
  /** Opt-in Linear link. Without it, nothing Linear-related runs. */
  linear?: LinearConfig;
}

export interface LinearConfig {
  /** Team key, e.g. "SAV". */
  team: string;
  /** Status names to use. By default cairn moves issues by status type (started, completed); review has no type, so without `inReview` that move is a comment. */
  statuses?: { inProgress?: string; inReview?: string; done?: string };
  /** Issues with this label make the plan foundational: an explicit, approved approach. Default "foundational". */
  foundationalLabel?: string;
  /** Which open follow-ups a close files as Linear issues: ordinary ones only (default), all (hardening too), or none. */
  fileFollowUps?: 'ordinary' | 'all' | 'none';
}
