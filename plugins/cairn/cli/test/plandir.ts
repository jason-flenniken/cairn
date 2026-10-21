import { join } from 'node:path';
import { planRelIn } from '../src/locate.ts';

/** A plan's folder inside a checkout, under whichever name it carries (`<date>-<slug>` or the old `<slug>`). */
export const pd = (root: string, slug: string): string => join(root, planRelIn(slug, root));
