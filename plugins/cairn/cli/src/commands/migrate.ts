import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from '../config.ts';
import { git, gitOk } from '../git.ts';
import type { Ctx } from '../locate.ts';
import { CAIRN_DIR, DOCS_DIR, LEGACY_CAIRN_DIR, LEGACY_DOCS_DIR } from '../paths.ts';
import { Refusal } from '../util.ts';
import type { Result } from '../shared.ts';
import { listPlans } from './status.ts';

const PAIRS: [string, string][] = [
  [LEGACY_CAIRN_DIR, CAIRN_DIR],
  [LEGACY_DOCS_DIR, DOCS_DIR],
];

/** The legacy folders present under `root`. */
export const legacyLayout = (root: string): string[] => PAIRS.map(([old]) => old).filter((p) => existsSync(join(root, p)));

const tracked = (root: string, rel: string) => git(['ls-files', '--', rel], root) !== '';

/** Move one path: `git mv` when tracked, a plain rename for untracked leftovers. */
function move(root: string, from: string, to: string): void {
  mkdirSync(dirname(join(root, to)), { recursive: true });
  if (tracked(root, from)) git(['mv', from, to], root);
  else renameSync(join(root, from), join(root, to));
}

function moveRoot(root: string, old: string, next: string): void {
  if (!existsSync(join(root, next))) return move(root, old, next);
  const clash = readdirSync(join(root, old)).filter((n) => existsSync(join(root, next, n)));
  if (clash.length) throw new Refusal(`${next}/ already has ${clash.join(', ')}, which ${old}/ also has`, [`merge or remove them by hand, then run cairn migrate again`]);
  for (const n of readdirSync(join(root, old))) move(root, `${old}/${n}`, `${next}/${n}`);
}

export function cmdMigrate(ctx: Ctx): Result {
  if (ctx.plan) throw new Refusal('run cairn migrate on the main branch, outside any plan');
  const root = ctx.top;
  const found = PAIRS.filter(([old]) => existsSync(join(root, old)));
  if (!found.length) return { message: `Nothing to migrate: this repo already uses ${CAIRN_DIR}/ and ${DOCS_DIR}/.` };
  const open = listPlans(ctx).filter((r) => r.state.stage !== 'closed');
  if (open.length) throw new Refusal(`these plans are still open: ${open.map((r) => r.state.slug).join(', ')}`, ['finish or close them first']);
  if (git(['status', '--porcelain'], root)) throw new Refusal('the working tree has uncommitted changes', ['commit or stash your changes first']);
  for (const [old, next] of found) moveRoot(root, old, next);
  const msg = 'cairn: move .sdlc to .cairn and docs/sdlc to docs/cairn';
  if (loadConfig(ctx.top, ctx.mainRoot).autoCommit) {
    git(['add', '-A', '--', ...found.map(([, n]) => n)], root);
    if (!gitOk(['diff', '--cached', '--quiet'], root)) git(['commit', '-q', '-m', msg], root);
  }
  return { message: `Moved ${found.map(([o, n]) => `${o}/ to ${n}/`).join(' and ')}.` };
}
