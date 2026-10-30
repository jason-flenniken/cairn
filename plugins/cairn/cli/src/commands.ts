import { context } from './locate.ts';
import { worktrees } from './git.ts';
import { runTests } from './shared.ts';

export type { Opts, Result } from './shared.ts';
export { cmdNew, cmdProductInit, cmdDecide } from './commands/plans.ts';
export { cmdApprove, cmdAdvance, cmdClose } from './commands/stages.ts';
export { cmdLevel } from './commands/level.ts';
export { cmdPlanLoad } from './commands/planload.ts';
export { cmdReady, cmdTask } from './commands/tasks.ts';
export { cmdIndex, removed } from './commands/memory.ts';
export { cmdEscalate, cmdRepro } from './commands/fix.ts';
export { cmdStep } from './commands/step.ts';
export { cmdMergeCheck, cmdTrace } from './commands/merge.ts';
export { cmdPhase, cmdTest } from './commands/phase.ts';
export { cmdMigrate, legacyLayout } from './commands/migrate.ts';
export { cmdRecords } from './commands/records.ts';
export { cmdSuggest } from './commands/suggest.ts';
export { cmdEvidence, cmdDriftAck } from './commands/evidence.ts';
export { cmdPause, cmdResume } from './commands/pause.ts';
export { cmdStatus, cmdNext, cmdRender, listPlans, procedurePath } from './commands/status.ts';
export { hookSessionStart, hookPostEdit } from './commands/hooks.ts';

export { context };
export const _internal = { runTests, worktrees };
