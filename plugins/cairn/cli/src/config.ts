import { join } from 'node:path';
import type { Config, State } from './types.ts';
import { CAIRN_DIR, LEGACY_CAIRN_DIR } from './paths.ts';
import { CliError, hashText, readText } from './util.ts';

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

/** The commands whose change needs the user (FR-32). `testQuick` is left out: a quick run never stands in for the full suite. */
export const LOCKED_COMMANDS = ['setup', 'test', 'build'] as const;
export type Commands = Partial<Record<(typeof LOCKED_COMMANDS)[number], string>>;
export const lockedCommands = (cfg: Config): Commands => ({ setup: cfg.setup, test: cfg.test, build: cfg.build });

/** Hash of the commands cairn runs for the plan. A missing config hashes as empty. */
export const configHash = (cfg: Config): string => hashText(JSON.stringify(lockedCommands(cfg)));
/** The hash 0.24.0 and earlier recorded, with `testQuick` in it: a plan approved then still matches. */
const legacyConfigHash = (cfg: Config): string => hashText(JSON.stringify({ ...lockedCommands(cfg), testQuick: cfg.testQuick }));

/** True when a locked command differs from the ones the user approved. Plans without a recorded hash are not checked. */
export const commandsChanged = (s: State, cfg: Config): boolean =>
  !!s.configHash && s.configHash !== configHash(cfg) && s.configHash !== legacyConfigHash(cfg);

/**
 * A plan locked under the old hash moves to the new one while its commands still match it, so a later testQuick
 * change is not a change. Every state write runs this, so it lands before the model gets to edit the config.
 */
export function upgradeLegacyLock(s: State, cfg: Config): void {
  if (!s.configHash || s.configHash === configHash(cfg) || s.configHash !== legacyConfigHash(cfg)) return;
  s.configHash = configHash(cfg);
  s.approvedCommands ??= lockedCommands(cfg);
}

/** Record the current commands as the ones the user approved. */
export function approveCommands(s: State, cfg: Config): void {
  s.configHash = configHash(cfg);
  s.approvedCommands = lockedCommands(cfg);
}
