import { join } from 'node:path';
import type { Config } from './types.ts';
import { CliError, readText } from './util.ts';

export const CONFIG_REL = '.sdlc/config.json';

const DEFAULTS: Config = { maxParallel: 3, autoCommit: true };

/** Config from the first of the given roots that has one (plan worktree, then main). */
export function loadConfig(...roots: (string | undefined)[]): Config {
  for (const root of roots) {
    if (!root) continue;
    const raw = readText(join(root, CONFIG_REL));
    if (raw === undefined) continue;
    try {
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (e) {
      throw new CliError(`${CONFIG_REL} is not valid JSON: ${(e as Error).message}`);
    }
  }
  return { ...DEFAULTS };
}

export const worktreeRoot = (cfg: Config, mainRoot: string) =>
  cfg.worktreeRoot ? join(mainRoot, cfg.worktreeRoot) : join(mainRoot, '.claude', 'worktrees');
