export const STAGES = ['discover', 'prd', 'plan', 'execute', 'verify', 'review', 'ship', 'learn', 'closed'] as const;
export type Stage = (typeof STAGES)[number];
export type Track = 'feature' | 'fix';
export type Complexity = 'simple' | 'standard' | 'complex';
export type SliceStatus = 'pending' | 'in_progress' | 'done';
export const SUBSTEPS = ['implementing', 'reviewing', 'fixing', 'merging', 'blocked'] as const;
export type Substep = (typeof SUBSTEPS)[number];
export type PhaseStatus = 'pending' | 'in_progress' | 'awaiting_approval' | 'done';

export interface Approval {
  at: string;
  via: 'agent' | 'human';
  note?: string;
  hash?: string;
}

export interface Slice {
  id: string;
  name: string;
  covers: string[];
  blockedBy: string[];
  scope: string[];
  complexity: Complexity;
  status: SliceStatus;
  substep?: Substep;
  fixRound: number;
  note?: string;
  branch?: string;
  worktree?: string;
  /** Plan-branch commit the slice started from. */
  base?: string;
  tip?: string;
  tests?: string;
  doneAt?: string;
}

export interface Phase {
  id: string;
  name: string;
  status: PhaseStatus;
  slices: Slice[];
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
  slice?: string;
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
  phases: Phase[];
  evidence: { verify?: Evidence; review?: Evidence };
  drift: DriftEntry[];
  log: LogEntry[];
}

export interface Config {
  /** Run in every new plan and slice worktree (e.g. install dependencies). CAIRN_MAIN_ROOT is set. */
  setup?: string;
  test?: string;
  build?: string;
  start?: string;
  seed?: string;
  appTypes?: string[];
  maxParallel: number;
  autoCommit: boolean;
  worktreeRoot?: string;
}
