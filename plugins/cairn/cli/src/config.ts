import { join } from 'node:path';
import type { Config } from './types.ts';
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
