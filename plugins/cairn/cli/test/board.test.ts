import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBoard } from '../src/board.ts';
import type { BoardSnapshot, IssueProgress } from '../src/linear.ts';
import type { LinearIssue, State } from '../src/types.ts';

type Issue = Partial<LinearIssue> & { key: string };
const issue = (x: Issue): LinearIssue => ({ title: `Title ${x.key}`, blockedBy: [], ...x });
const snapOf = (issues: Issue[], milestones: string[] = []): BoardSnapshot => ({ project: 'P', milestones, issues: issues.map(issue), readAt: new Date().toISOString() });
const planOf = (slug: string, keys: string[], extra: { stage?: string; epic?: string; title?: string } = {}) => ({
  slug,
  stage: extra.stage ?? 'build',
  state: { slug, title: extra.title ?? `Plan ${slug}`, updated: new Date().toISOString(), linear: { team: 'SAV', issues: keys.map((key) => issue({ key })), known: [], depends: [], changes: [], outbox: [], importedAt: '', ...(extra.epic ? { epic: extra.epic } : {}) } } as unknown as State,
});
const build = (snap: BoardSnapshot, plans: ReturnType<typeof planOf>[] = [], progress = new Map<string, Map<string, IssueProgress>>()) => buildBoard({ snap, plans, progress });
const leaf = (b: ReturnType<typeof build>, key: string) => b.milestones.flatMap((m) => [...m.issues, ...m.epics.flatMap((e) => e.issues)]).find((x) => x.key === key)!;
const epic = (b: ReturnType<typeof build>, key: string) => b.milestones.flatMap((m) => m.epics).find((e) => e.key === key)!;

test('FR-01: a blocker in the same milestone has no tag; other milestones, plans and projects do', () => {
  const b = build(
    snapOf(
      [
        { key: 'SAV-1', milestone: 'M1' },
        { key: 'SAV-2', milestone: 'M2' },
        { key: 'SAV-3', milestone: 'M2', blockedBy: ['SAV-2', 'SAV-1'] },
        { key: 'SAV-4', milestone: 'M2', blockedBy: ['SAV-5', 'OTH-9'] },
        { key: 'SAV-5', milestone: 'M2' },
      ],
      ['M1', 'M2'],
    ),
    [planOf('other', ['SAV-5'], { stage: 'review' })],
  );
  // Linear order: SAV-1 comes before SAV-2 in the project.
  assert.deepEqual(leaf(b, 'SAV-3').blockedBy, [{ key: 'SAV-1', where: 'milestone M1' }, { key: 'SAV-2' }]);
  assert.equal('where' in leaf(b, 'SAV-3').blockedBy[1], false);
  assert.deepEqual(leaf(b, 'SAV-4').blockedBy, [{ key: 'SAV-5', where: 'plan other (review)' }, { key: 'OTH-9', where: 'another project' }]);
});

test('FR-02: unblocks counts every open issue waiting on it through a chain, once each', () => {
  const b = build(
    snapOf([
      { key: 'A' },
      { key: 'B', blockedBy: ['A'] },
      { key: 'C', blockedBy: ['B'] },
      { key: 'D', blockedBy: ['A'] },
      { key: 'E', blockedBy: ['A', 'B'] },
      { key: 'F', blockedBy: ['A'], stateType: 'completed' },
    ]),
  );
  assert.equal(leaf(b, 'A').unblocks, 4, 'B, C, D and E; done F is not counted, E is counted once');
  assert.equal(leaf(b, 'B').unblocks, undefined, 'blocked issues carry no count');
  assert.equal(leaf(b, 'F').unblocks, undefined, 'done issues carry no count');
});

test('FR-02: the PRD chain A <- B <- C plus D gives A unblocks 3, and an in-plan issue counts too', () => {
  const b = build(snapOf([{ key: 'A' }, { key: 'B', blockedBy: ['A'] }, { key: 'C', blockedBy: ['B'] }, { key: 'D', blockedBy: ['A'] }, { key: 'G' }, { key: 'H', blockedBy: ['G'] }]), [planOf('p', ['G'])]);
  assert.equal(leaf(b, 'A').unblocks, 3);
  assert.equal(leaf(b, 'G').status, 'in plan');
  assert.equal(leaf(b, 'G').unblocks, 1);
});

test('FR-02: a loop in the links ends the walk', () => {
  const b = build(snapOf([{ key: 'A' }, { key: 'B', blockedBy: ['A', 'C'] }, { key: 'C', blockedBy: ['B'] }]));
  assert.equal(leaf(b, 'A').unblocks, 2);
  assert.deepEqual(b.cycle?.slice().sort(), ['B', 'B', 'C']);
});

test('FR-02: a link to an epic waits on each of its sub-issues', () => {
  const b = build(snapOf([{ key: 'E1' }, { key: 'S1', parent: 'E1' }, { key: 'E2', blockedBy: ['E1'] }, { key: 'T1', parent: 'E2' }, { key: 'T2', parent: 'E2' }, { key: 'X', blockedBy: ['T1'] }]));
  assert.equal(leaf(b, 'S1').unblocks, 3, 'T1 and T2 through E2, then X through T1');
  assert.equal(epic(b, 'E1').unblocks, 3);
});

test('FR-03: epic state, waitsOn outside the epic, and unblocks', () => {
  const b = build(
    snapOf([
      { key: 'E1' },
      { key: 'S1', parent: 'E1' },
      { key: 'S2', parent: 'E1' },
      { key: 'E2', blockedBy: ['E1'] },
      { key: 'T1', parent: 'E2' },
      { key: 'T2', parent: 'E2', blockedBy: ['T1'] },
      { key: 'E3' },
      { key: 'U1', parent: 'E3' },
      { key: 'U2', parent: 'E3', blockedBy: ['Z'] },
      { key: 'Z' },
      { key: 'E4' },
      { key: 'V1', parent: 'E4', stateType: 'completed' },
    ]),
    [planOf('p', ['U1'])],
  );
  assert.equal(epic(b, 'E1').state, 'ready');
  assert.deepEqual(epic(b, 'E1').waitsOn, []);
  assert.equal(epic(b, 'E1').unblocks, 2, 'T1 and T2 wait on E1');
  assert.equal(epic(b, 'E2').state, 'waiting');
  assert.deepEqual(epic(b, 'E2').waitsOn, ['E1'], 'the sibling T1 is inside the epic');
  assert.equal(epic(b, 'E2').unblocks, 0);
  assert.equal(epic(b, 'E3').state, 'active');
  assert.deepEqual(epic(b, 'E3').waitsOn, ['Z']);
  assert.equal(epic(b, 'E4').state, 'done');
  assert.deepEqual(b.readyEpics, ['E1']);
});

test('FR-04: an epic own link is wide at 3 open sub-issues, not at 2, and never from a sub-issue', () => {
  const wide = build(
    snapOf([
      { key: 'B1' },
      { key: 'E', blockedBy: ['B1'] },
      { key: 'S1', parent: 'E' },
      { key: 'S2', parent: 'E' },
      { key: 'S3', parent: 'E' },
      { key: 'S4', parent: 'E', stateType: 'completed' },
      { key: 'F', blockedBy: ['B1'] },
      { key: 'R1', parent: 'F' },
      { key: 'R2', parent: 'F' },
      { key: 'R3', parent: 'F', stateType: 'completed' },
      { key: 'G' },
      { key: 'Q1', parent: 'G', blockedBy: ['B1'] },
      { key: 'Q2', parent: 'G', blockedBy: ['B1'] },
      { key: 'Q3', parent: 'G', blockedBy: ['B1'] },
      { key: 'H', blockedBy: ['DONE'] },
      { key: 'P1', parent: 'H' },
      { key: 'P2', parent: 'H' },
      { key: 'P3', parent: 'H' },
      { key: 'DONE', stateType: 'completed' },
    ]),
  );
  assert.deepEqual(wide.wideLinks, [{ epic: 'E', on: 'B1', holds: 3 }]);
});

test('FR-05: two-milestone sections', () => {
  const b = build(
    snapOf(
      [
        { key: 'SAV-1', milestone: 'M1' },
        { key: 'SAV-2', milestone: 'M1', blockedBy: ['SAV-1'] },
        { key: 'SAV-3', milestone: 'M1', stateType: 'completed' },
        { key: 'SAV-10', milestone: 'M1' },
        { key: 'SAV-11', milestone: 'M1', parent: 'SAV-10', blockedBy: ['SAV-2'] },
        { key: 'SAV-12', milestone: 'M1', parent: 'SAV-10' },
        { key: 'SAV-20', milestone: 'M2', title: 'Built by a plan' },
        { key: 'SAV-21', milestone: 'M2', title: 'Ready later' },
        { key: 'SAV-22', milestone: 'M2', blockedBy: ['SAV-2'] },
        { key: 'SAV-23', milestone: 'M2', blockedBy: ['SAV-21'] },
        { key: 'SAV-30' },
      ],
      ['M1', 'M2'],
    ),
    [planOf('p2', ['SAV-20'], { title: 'Second milestone work' }), planOf('old', ['SAV-30'], { stage: 'closed' })],
    new Map([['p2', new Map<string, IssueProgress>([['SAV-20', 'in progress']])]]),
  );
  assert.equal(b.focus, 'M1');
  assert.deepEqual(
    b.milestones.map((m) => m.name),
    ['M1', 'M2', 'No milestone'],
  );
  assert.equal(b.milestones[0].waitsOn, undefined, 'the focus milestone has no waitsOn');
  assert.deepEqual(b.milestones[1].waitsOn, ['SAV-2'], 'only blockers outside M2');
  assert.deepEqual(b.milestones[2].waitsOn, []);
  assert.deepEqual(b.inProgress, [{ slug: 'p2', stage: 'build', title: 'Second milestone work', done: 0, total: 1, issues: [{ key: 'SAV-20', title: 'Built by a plan', progress: 'in progress' }] }]);
  assert.deepEqual(
    b.ready.map((r) => [r.key, r.milestone, r.unblocks]),
    [
      ['SAV-1', 'M1', 3],
      ['SAV-21', 'M2', 1],
      ['SAV-12', 'M1', 0],
    ],
    'sorted by unblocks; a ready issue inside a waiting epic is listed; SAV-30 is owned by a closed plan',
  );
  assert.deepEqual(b.waiting, [
    { key: 'SAV-10', title: 'Title SAV-10', kind: 'epic', done: 0, total: 2, waitsOn: ['SAV-2'] },
    { key: 'SAV-2', title: 'Title SAV-2', kind: 'issue', waitsOn: ['SAV-1'] },
  ]);
  assert.equal(b.done, 1);
  assert.deepEqual(b.plans.map((p) => p.slug), ['p2']);
});

test('FR-05: a ready epic leads the ready list and hides its own issues; the plan row carries its epic', () => {
  const b = build(
    snapOf([{ key: 'E' }, { key: 'S1', parent: 'E' }, { key: 'S2', parent: 'E' }, { key: 'X', blockedBy: ['E'] }, { key: 'Y' }, { key: 'Z', blockedBy: ['Y'] }, { key: 'W', blockedBy: ['Y'] }, { key: 'F', title: 'Epic F' }, { key: 'T1', parent: 'F', stateType: 'completed' }, { key: 'T2', parent: 'F' }]),
    [planOf('pf', ['F', 'T1', 'T2'], { epic: 'F' })],
  );
  assert.deepEqual(
    b.ready.map((r) => [r.key, r.kind]),
    [
      ['E', 'epic'],
      ['Y', 'issue'],
    ],
  );
  assert.deepEqual(
    b.inProgress.map((p) => [p.epic, p.title, p.done, p.total, p.issues.map((i) => i.key)]),
    [['F', 'Epic F', 1, 2, ['T1', 'T2']]],
  );
});

test('FR-05: everything done leaves no focus', () => {
  const b = build(snapOf([{ key: 'A', milestone: 'M1', stateType: 'completed' }], ['M1']));
  assert.equal(b.focus, null);
  assert.deepEqual(b.waiting, []);
  assert.deepEqual(b.milestones[0].waitsOn, []);
  assert.equal(b.done, 1);
});

test('FR-05: epics and their issues come out in Linear order even when a child is listed before its epic', () => {
  const b = build(
    snapOf([
      { key: 'E2-a', parent: 'E2' },
      { key: 'E1-n', parent: 'N' },
      { key: 'E1-a', parent: 'E1' },
      { key: 'E1', blockedBy: ['W'] },
      { key: 'E2', blockedBy: ['W'] },
      { key: 'N', parent: 'E1' },
      { key: 'E1-b', parent: 'E1' },
      { key: 'E1-c', parent: 'E1' },
      { key: 'E2-b', parent: 'E2' },
      { key: 'E2-c', parent: 'E2' },
      { key: 'W' },
      { key: 'R2', parent: 'RE2' },
      { key: 'R1', parent: 'RE1' },
      { key: 'RE1' },
      { key: 'RE2' },
    ]),
  );
  assert.deepEqual(
    b.milestones[0].epics.map((e) => e.key),
    ['E1', 'E2', 'RE1', 'RE2'],
  );
  assert.deepEqual(
    epic(b, 'E1').issues.map((x) => x.key),
    ['E1-n', 'E1-a', 'E1-b', 'E1-c'],
    'a nested epic issue keeps its own position',
  );
  assert.deepEqual(b.readyEpics, ['RE1', 'RE2']);
  assert.deepEqual(
    b.waiting.filter((w) => w.kind === 'epic').map((w) => w.key),
    ['E1', 'E2'],
  );
  assert.deepEqual(
    b.wideLinks.map((w) => w.epic),
    ['E1', 'E2'],
  );
});

const planWith = (slug: string, keys: string[], branch: string, stage: string) => {
  const p = planOf(slug, keys, { stage });
  (p.state as unknown as { branch: string }).branch = branch;
  return p;
};
const progressOf = (slug: string, entries: [string, IssueProgress][]) => new Map([[slug, new Map(entries)]]);

test('alongside: an issue blocked only by work another open plan has built or has in review can start alongside it', () => {
  const snap = snapOf([{ key: 'A' }, { key: 'B', blockedBy: ['A'] }, { key: 'C', blockedBy: ['A', 'Z'] }, { key: 'Z' }]);
  for (const [prog, expected] of [['built', 'alongside'], ['in review', 'alongside'], ['shipped', 'alongside'], ['in progress', 'blocked'], ['not started', 'blocked']] as const) {
    const b = build(snap, [planWith('p', ['A'], 'feature/p', 'verify')], progressOf('p', [['A', prog]]));
    assert.equal(leaf(b, 'B').status, expected, prog);
  }
  const b = build(snap, [planWith('p', ['A'], 'feature/p', 'verify')], progressOf('p', [['A', 'built']]));
  assert.deepEqual(leaf(b, 'B').after, [{ key: 'A', slug: 'p', stage: 'verify', branch: 'feature/p' }]);
  assert.equal(leaf(b, 'C').status, 'blocked', 'Z is open and in no plan, so C still waits');
  assert.deepEqual(b.alongside.map((x) => x.key), ['B']);
  assert.deepEqual(b.alongside[0].after, [{ key: 'A', slug: 'p', stage: 'verify', branch: 'feature/p' }]);
  assert.equal(b.waiting.some((w) => w.key === 'B'), false, 'alongside work is not listed as waiting');
  assert.equal(b.ready.some((w) => w.key === 'B'), false);
  assert.equal(b.milestones[0].counts.alongside, 1);
});

test('alongside: a closed plan does not count, and an issue already in a plan is in plan', () => {
  const snap = snapOf([{ key: 'A' }, { key: 'B', blockedBy: ['A'] }, { key: 'D', blockedBy: ['A'] }]);
  const closed = build(snap, [planWith('p', ['A'], 'feature/p', 'closed')], progressOf('p', [['A', 'shipped']]));
  assert.equal(leaf(closed, 'B').status, 'blocked');
  const taken = build(snap, [planWith('p', ['A'], 'feature/p', 'verify'), planWith('q', ['D'], 'feature/q', 'plan')], new Map([...progressOf('p', [['A', 'built']]), ...progressOf('q', [])]));
  assert.equal(leaf(taken, 'D').status, 'in plan');
  assert.equal(leaf(taken, 'B').status, 'alongside');
});

test('alongside: an epic whose open sub-issues are all ready or alongside, with one alongside, is one alongside row', () => {
  const snap = snapOf([{ key: 'A' }, { key: 'E' }, { key: 'E1', parent: 'E', blockedBy: ['A'] }, { key: 'E2', parent: 'E', blockedBy: ['A'] }, { key: 'E3', parent: 'E' }, { key: 'F' }, { key: 'F1', parent: 'F' }, { key: 'F2', parent: 'F', blockedBy: ['Z'] }, { key: 'Z' }]);
  const b = build(snap, [planWith('p', ['A'], 'feature/p', 'review')], progressOf('p', [['A', 'built']]));
  assert.equal(epic(b, 'E').state, 'alongside');
  assert.deepEqual(epic(b, 'E').after, [{ key: 'A', slug: 'p', stage: 'review', branch: 'feature/p' }]);
  assert.deepEqual(b.alongside.map((x) => [x.key, x.kind]), [['E', 'epic']], 'its sub-issues are folded into it');
  assert.equal(epic(b, 'F').state, 'waiting', 'a sub-issue with an open blocker outside the epic keeps it waiting');
  assert.equal(b.waiting.some((w) => w.key === 'F'), true);
});

test('alongside: ordered like ready, by what each unblocks', () => {
  const snap = snapOf([{ key: 'A' }, { key: 'B', blockedBy: ['A'] }, { key: 'C', blockedBy: ['A'] }, { key: 'D', blockedBy: ['C'] }]);
  const b = build(snap, [planWith('p', ['A'], 'feature/p', 'verify')], progressOf('p', [['A', 'built']]));
  assert.deepEqual(b.alongside.map((x) => x.key), ['C', 'B']);
  assert.equal(b.alongside[0].unblocks, 1);
});

test('alongside: a blocker qualifies only when its plan is built, whatever the issue progress says', () => {
  const snap = snapOf([{ key: 'A' }, { key: 'B', blockedBy: ['A'] }]);
  const building = build(snap, [planWith('p', ['A'], 'feature/p', 'execute')], progressOf('p', [['A', 'built']]));
  assert.equal(leaf(building, 'B').status, 'blocked', 'the plan is still in execute with tasks open');
  const p = planWith('p', ['A'], 'feature/p', 'execute');
  (p.state as unknown as { phases: unknown }).phases = [{ tasks: [{ status: 'done' }, { status: 'done' }] }];
  assert.equal(leaf(build(snap, [p], progressOf('p', [['A', 'built']])), 'B').status, 'alongside', 'every task done counts as built');
});

test('alongside: an epic whose sub-issues are blocked by siblings and by a built plan is one alongside row, not waiting', () => {
  const snap = snapOf([{ key: 'A' }, { key: 'E', blockedBy: ['A'] }, { key: 'E1', parent: 'E' }, { key: 'E2', parent: 'E', blockedBy: ['E1'] }, { key: 'E3', parent: 'E' }]);
  const b = build(snap, [planWith('p', ['A'], 'feature/p', 'verify')], progressOf('p', [['A', 'built']]));
  assert.equal(epic(b, 'E').state, 'alongside');
  assert.deepEqual(epic(b, 'E').after, [{ key: 'A', slug: 'p', stage: 'verify', branch: 'feature/p' }]);
  assert.deepEqual(b.alongside.map((x) => [x.key, x.kind]), [['E', 'epic']]);
  assert.equal(b.waiting.some((w) => w.key === 'E'), false);
});

test('alongside: an epic with a real outside blocker waits on that blocker only', () => {
  const snap = snapOf([{ key: 'A' }, { key: 'B' }, { key: 'E', blockedBy: ['A'] }, { key: 'E1', parent: 'E' }, { key: 'E2', parent: 'E', blockedBy: ['E1', 'B'] }, { key: 'E3', parent: 'E' }]);
  const b = build(snap, [planWith('p', ['A'], 'feature/p', 'verify')], progressOf('p', [['A', 'built']]));
  assert.equal(epic(b, 'E').state, 'waiting');
  assert.deepEqual(epic(b, 'E').waitsOn, ['B']);
  assert.deepEqual(b.waiting.find((w) => w.key === 'E')!.waitsOn, ['B']);
});
