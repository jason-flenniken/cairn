import { join } from 'node:path';
import { renderStatus } from './render.ts';
import { LEVELS, type Level, type Phase, type Stage, type State } from './types.ts';
import { CliError, now, readText, writeText } from './util.ts';

export const statePath = (dir: string) => join(dir, 'state.json');

// Legacy plans stored `phase.slices`; read them as `phase.tasks`.
function normalize(s: State): State {
  for (const p of s.phases ?? []) {
    const legacy = p as unknown as { slices?: Phase['tasks'] };
    p.tasks ??= legacy.slices as Phase['tasks'];
    delete legacy.slices;
  }
  return s;
}

export function loadState(dir: string): State {
  const raw = readText(statePath(dir));
  if (raw === undefined) throw new CliError(`no state.json in ${dir}`);
  const s = normalize(JSON.parse(raw) as State);
  if (s.schema !== 1) throw new CliError(`unsupported state schema ${s.schema}`);
  return s;
}

export function parseState(raw: string): State {
  return normalize(JSON.parse(raw) as State);
}

export function saveState(dir: string, s: State): void {
  s.updated = now();
  writeText(statePath(dir), JSON.stringify(s, null, 2) + '\n');
  writeText(join(dir, 'STATUS.md'), renderStatus(s));
}

export function log(s: State, event: string, detail?: string, override?: string): void {
  s.log.push({ at: now(), event, ...(detail ? { detail } : {}), ...(override ? { override } : {}) });
}

/** The plan's level; plans and the fix track without one read as Standard. */
export const levelOf = (s: Pick<State, 'level'>): Level => (s.level && LEVELS.includes(s.level) ? s.level : 'standard');

/** Every stage change goes through here, so the stage history is complete. */
export function setStage(s: State, stage: Stage): void {
  s.stage = stage;
  (s.stageHistory ??= []).push({ stage, at: now() });
}

/**
 * Milliseconds spent in each stage, summing every visit and leaving out paused time; a paused plan's current
 * stage is frozen at the pause. Null for plans with no history. A closed plan stops counting at close.
 */
export function stageTimes(s: State, nowMs = Date.now()): Partial<Record<Stage, number>> | null {
  const h = s.stageHistory;
  if (!h?.length) return null;
  const pauses: [number, number][] = [];
  let from: number | undefined;
  for (const l of s.log) {
    if (l.event === 'paused') from = Date.parse(l.at);
    else if (l.event === 'resumed' && from !== undefined) {
      pauses.push([from, Date.parse(l.at)]);
      from = undefined;
    }
  }
  if (from !== undefined) pauses.push([from, Infinity]);
  const out: Partial<Record<Stage, number>> = {};
  h.forEach((e, i) => {
    if (e.stage === 'closed') return;
    const a = Date.parse(e.at);
    const b = i + 1 < h.length ? Date.parse(h[i + 1].at) : nowMs;
    const paused = pauses.reduce((sum, [p, q]) => sum + Math.max(0, Math.min(b, q) - Math.max(a, p)), 0);
    out[e.stage] = (out[e.stage] ?? 0) + Math.max(0, b - a - paused);
  });
  return out;
}

export function newState(slug: string, title: string, track: State['track'], branch: string, base: string, stage: Stage = 'discover'): State {
  const t = now();
  return {
    schema: 1,
    slug,
    title,
    track,
    branch,
    base,
    created: t,
    updated: t,
    stage,
    stageHistory: [{ stage, at: t }],
    paused: null,
    approvals: {},
    phases: [],
    evidence: {},
    drift: [],
    log: [{ at: t, event: 'created' }],
  };
}
