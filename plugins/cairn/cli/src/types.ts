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
  verify: ['testing', 'scanning', 'fixing'],
  review: ['reviewing', 'fixing', 'rechecking'],
  ship: ['approving', 'opening-pr', 'merging'],
};
export const STEP_LABEL: Record<string, string> = {
  testing: 'running tests',
  scanning: 'scanning for secrets',
  fixing: 'fixing',
  reviewing: 'reviewing',
  rechecking: 're-checking',
  approving: 'waiting on approval',
  'opening-pr': 'opening the PR',
  merging: 'merging',
};
export interface Step {
  stage: Stage;
  name: string;
  count?: number;
  at: string;
}
export type Track = 'feature' | 'fix';
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
}

export interface Task {
  id: string;
  name: string;
  /** `prefactor` tasks prepare the code and may cover no requirement. */
  kind?: 'prefactor';
  covers: string[];
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
export const SUGGESTION_SOURCES = ['task-review', 'branch-review', 'check', 'implementer', 'plan', 'user'] as const;

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
  branch: string;
  base: string;
  created: string;
  updated: string;
  stage: Stage;
  paused: { at: string; mode: 'drain' | 'now'; handoffHash?: string } | null;
  approvals: { prd?: Approval; plan?: Approval; ship?: Approval };
  planHash?: string;
  /** What the check, review or ship stage is doing now. Cleared when the stage changes. */
  step?: Step;
  repro?: { cmd: string; tail: string; at: string };
  configHash?: string;
  phases: Phase[];
  evidence: { verify?: Evidence; review?: Evidence };
  drift: DriftEntry[];
  suggestions?: Suggestion[];
  log: LogEntry[];
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
}
