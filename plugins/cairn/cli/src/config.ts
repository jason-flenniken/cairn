import { join } from 'node:path';
import type { Config, State } from './types.ts';
import { CAIRN_DIR, LEGACY_CAIRN_DIR } from './paths.ts';
import { CliError, readText } from './util.ts';

export const CONFIG_REL = `${CAIRN_DIR}/config.json`;
export const LEGACY_CONFIG_REL = `${LEGACY_CAIRN_DIR}/config.json`;

const DEFAULTS: Config = { maxParallel: 3, autoCommit: true };

/** Warning when a root holds both config files; undefined otherwise. */
export function configWarning(root: string): string | undefined {
  if (readText(join(root, CONFIG_REL)) === undefined || readText(join(root, LEGACY_CONFIG_REL)) === undefined) return undefined;
  return `both ${CONFIG_REL} and ${LEGACY_CONFIG_REL} exist; ${CONFIG_REL} is used. Delete ${LEGACY_CONFIG_REL}.`;
}

/** Config from the first of the given roots that has one (plan worktree, then main); `.cairn` before legacy `.sdlc` within a root. */
export function loadConfig(...roots: (string | undefined)[]): Config {
  for (const root of roots) {
    if (!root) continue;
    for (const rel of [CONFIG_REL, LEGACY_CONFIG_REL]) {
      const raw = readText(join(root, rel));
      if (raw === undefined) continue;
      try {
        return { ...DEFAULTS, ...JSON.parse(raw) };
      } catch (e) {
        throw new CliError(`${rel} is not valid JSON: ${(e as Error).message}`);
      }
    }
  }
  return { ...DEFAULTS };
}

export const worktreeRoot = (cfg: Config, mainRoot: string) =>
  cfg.worktreeRoot ? join(mainRoot, cfg.worktreeRoot) : join(mainRoot, '.claude', 'worktrees');

/** The commands cairn runs for a plan. A change to one mid-run is a choice about how to build: recorded, never asked. */
export const RUN_COMMANDS = ['setup', 'test', 'build'] as const;
export type Commands = Partial<Record<(typeof RUN_COMMANDS)[number], string>>;
export const runCommands = (cfg: Config): Commands => ({ setup: cfg.setup, test: cfg.test, build: cfg.build });

/**
 * Keep the plan's record of its commands current. The first sight records them; a later difference is added to
 * `calls` as `name: old → new`, so the PR shows what the run changed. Every state write runs this.
 */
export function noteCommands(s: State, cfg: Config): void {
  const cur = runCommands(cfg);
  const was = s.approvedCommands;
  if (!s.approvals.prd && !s.repro) return;
  if (!was) {
    s.approvedCommands = cur;
    return;
  }
  const shown = (v: string | undefined) => (v ? `\`${v}\`` : '(none)');
  const changed = RUN_COMMANDS.filter((k) => was[k] !== cur[k]);
  if (!changed.length) return;
  const what = changed.map((k) => `${k}: ${shown(was[k])} → ${shown(cur[k])}`).join('; ');
  (s.calls ??= []).push({ at: new Date().toISOString(), event: 'commands', what: `the commands cairn runs changed: ${what}`, why: `edited in ${CONFIG_REL}` });
  s.log.push({ at: new Date().toISOString(), event: 'call: commands', detail: what });
  s.approvedCommands = cur;
}
