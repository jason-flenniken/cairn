import { join } from 'node:path';
import { renderStatus } from './render.ts';
import type { State } from './types.ts';
import { CliError, now, readText, writeText } from './util.ts';

export const statePath = (dir: string) => join(dir, 'state.json');

export function loadState(dir: string): State {
  const raw = readText(statePath(dir));
  if (raw === undefined) throw new CliError(`no state.json in ${dir}`);
  const s = JSON.parse(raw) as State;
  if (s.schema !== 1) throw new CliError(`unsupported state schema ${s.schema}`);
  return s;
}

export function parseState(raw: string): State {
  return JSON.parse(raw) as State;
}

export function saveState(dir: string, s: State): void {
  s.updated = now();
  writeText(statePath(dir), JSON.stringify(s, null, 2) + '\n');
  writeText(join(dir, 'STATUS.md'), renderStatus(s));
}

export function log(s: State, event: string, detail?: string, override?: string): void {
  s.log.push({ at: now(), event, ...(detail ? { detail } : {}), ...(override ? { override } : {}) });
}

export function newState(slug: string, title: string, track: State['track'], branch: string, base: string): State {
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
    stage: 'discover',
    paused: null,
    approvals: {},
    phases: [],
    evidence: {},
    drift: [],
    log: [{ at: t, event: 'created' }],
  };
}
