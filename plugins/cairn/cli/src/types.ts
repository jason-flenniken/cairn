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
  doneAt?: string;
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
  repro?: { cmd: string; tail: string; at: string };
  configHash?: string;
  phases: Phase[];
  evidence: { verify?: Evidence; review?: Evidence };
  drift: DriftEntry[];
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
