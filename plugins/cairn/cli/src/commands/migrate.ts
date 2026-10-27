import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, statSync } from 'node:fs';
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

interface Plan {
  moves: [string, string][];
  clashes: string[];
  dirs: string[];
}

const isDir = (root: string, rel: string) => statSync(join(root, rel)).isDirectory();

/** Walk `old` against `next`: whole entries move where the target is free, directories present in both are merged. */
function plan(root: string, old: string, next: string, out: Plan): void {
  if (!existsSync(join(root, next))) {
    out.moves.push([old, next]);
    return;
  }
  if (!isDir(root, old) || !isDir(root, next)) {
    out.clashes.push(next);
    return;
  }
  out.dirs.push(old);
  for (const n of readdirSync(join(root, old))) plan(root, `${old}/${n}`, `${next}/${n}`, out);
}

/** Remove the emptied legacy directories, deepest first. */
const prune = (root: string, dirs: string[]) => {
  for (const d of [...dirs].reverse()) if (existsSync(join(root, d)) && !readdirSync(join(root, d)).length) rmdirSync(join(root, d));
};

export function cmdMigrate(ctx: Ctx): Result {
  if (ctx.plan) throw new Refusal('run cairn migrate on the main branch, outside any plan');
  const root = ctx.top;
  const found = PAIRS.filter(([old]) => existsSync(join(root, old)));
  if (!found.length) return { message: `Nothing to migrate: this repo already uses ${CAIRN_DIR}/ and ${DOCS_DIR}/.` };
  const open = listPlans(ctx).filter((r) => r.state.stage !== 'closed');
  if (open.length) throw new Refusal(`these plans are still open: ${open.map((r) => r.state.slug).join(', ')}`, ['finish or close them first']);
  if (git(['status', '--porcelain'], root)) throw new Refusal('the working tree has uncommitted changes', ['commit or stash your changes first']);
  const p: Plan = { moves: [], clashes: [], dirs: [] };
  for (const [old, next] of found) plan(root, old, next, p);
  if (p.clashes.length) {
    const shown = p.clashes.slice(0, 10).join(', ');
    throw new Refusal(`both layouts have ${shown}${p.clashes.length > 10 ? ` and ${p.clashes.length - 10} more` : ''}`, ['merge or remove the duplicates by hand, then run cairn migrate again']);
  }
  for (const [from, to] of p.moves) move(root, from, to);
  prune(root, p.dirs);
  const msg = 'cairn: move .sdlc to .cairn and docs/sdlc to docs/cairn';
  if (loadConfig(ctx.top, ctx.mainRoot).autoCommit) {
    git(['add', '-A', '--', ...found.map(([, n]) => n)], root);
    if (!gitOk(['diff', '--cached', '--quiet'], root)) git(['commit', '-q', '-m', msg], root);
  }
  return { message: `Moved ${found.map(([o, n]) => `${o}/ to ${n}/`).join(' and ')}.` };
}
