import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onPhaseFinished, syncTickets } from '../src/commands/linear.ts';
import { issueProgress, prdLinearProblems, requirementOwners, settled, taskTickets } from '../src/linear.ts';
import type { LinearIssue, LinearLink, Phase, State, Task } from '../src/types.ts';

const issue = (key: string, extra: Partial<LinearIssue> = {}): LinearIssue => ({ key, title: key, blockedBy: [], ...extra });
const link = (issues: LinearIssue[], extra: Partial<LinearLink> = {}): LinearLink => ({ team: 'SAV', issues, known: [], importedAt: '', depends: [], changes: [], outbox: [], ...extra });
const task = (id: string, covers: string[], extra: Partial<Task> = {}): Task => ({ id, name: id, covers, blockedBy: [], scope: [], complexity: 'standard', status: 'pending', fixRound: 0, ...extra });
const phase = (tasks: Task[]): Phase => ({ id: 'p', name: 'p', status: 'in_progress', tasks });
const prd = (reqs: string) => `## Requirements\n${reqs}\n## Non-goals\nn\n`;

test('tickets: a requirement tagged with two tickets is refused at PRD approval', () => {
  const l = link([issue('SAV-1'), issue('SAV-2')]);
  const shared = prd('- **FR-01** a [SAV-1]\n- **FR-02** b [SAV-1, SAV-2]\n- **FR-03** c [SAV-2]');
  assert.deepEqual(Object.fromEntries(requirementOwners(shared, ['SAV-1', 'SAV-2'])), { 'FR-01': ['SAV-1'], 'FR-02': ['SAV-1', 'SAV-2'], 'FR-03': ['SAV-2'] });
  assert.ok(prdLinearProblems(l, shared).some((p) => /FR-02 is tagged SAV-1 and SAV-2/.test(p)));
  assert.deepEqual(prdLinearProblems(l, prd('- **FR-01** a [SAV-1]\n- **FR-02** b [SAV-2]')), []);
});

test('tickets: each task builds one ticket; untagged work goes under the epic; spans are named', () => {
  const l = link([issue('SAV-10'), issue('SAV-11', { parent: 'SAV-10' }), issue('SAV-12', { parent: 'SAV-10' })], { epic: 'SAV-10' });
  const md = prd('- **FR-01** a [SAV-11]\n- **FR-02** b [SAV-11]\n- **FR-03** c [SAV-12]\n- **FR-04** chores\n- **FR-05** d [SAV-10]');
  const { issueOf, spans } = taskTickets(l, [phase([task('a', ['FR-01', 'FR-02']), task('b', ['FR-03']), task('chore', ['FR-04']), task('epic', ['FR-05']), task('both', ['FR-02', 'FR-03'])])], md);
  assert.deepEqual(Object.fromEntries(issueOf), { a: 'SAV-11', b: 'SAV-12', chore: 'SAV-10', epic: 'SAV-10' });
  assert.deepEqual(spans, [{ task: 'both', keys: ['SAV-11', 'SAV-12'] }]);
  // No epic: untagged work belongs to no ticket.
  const loose = link([issue('SAV-11'), issue('SAV-12')]);
  assert.equal(taskTickets(loose, [phase([task('chore', ['FR-04'])])], md).issueOf.size, 0);
});

const plan = (tasks: Task[], issues: LinearIssue[]): State =>
  ({ slug: 'p', title: 'Pay', branch: 'feature/p', stage: 'execute', track: 'feature', phases: [phase(tasks)], linear: link(issues) }) as unknown as State;

test('tickets: progress per ticket, with "in review" once every task of it is reviewed or done', () => {
  const issues = [issue('SAV-1', { requirements: ['FR-01'] }), issue('SAV-2', { requirements: ['FR-02'] }), issue('SAV-3', { requirements: ['FR-03'] })];
  const s = plan(
    [
      task('a1', ['FR-01'], { issue: 'SAV-1', status: 'done' }),
      task('a2', ['FR-01'], { issue: 'SAV-1', status: 'in_progress', substep: 'reviewing' }),
      task('b1', ['FR-02'], { issue: 'SAV-2', status: 'in_progress', substep: 'implementing' }),
      task('c1', ['FR-03'], { issue: 'SAV-3' }),
    ],
    issues,
  );
  assert.deepEqual(Object.fromEntries(issueProgress(s)), { 'SAV-1': 'in review', 'SAV-2': 'in progress', 'SAV-3': 'not started' });
  s.phases[0].tasks[1].substep = 'fixing';
  assert.equal(issueProgress(s).get('SAV-1'), 'in review', 'fixing what review found is still review');
  s.phases[0].tasks[1].status = 'done';
  assert.equal(issueProgress(s).get('SAV-1'), 'built');
});

test('tickets: each ticket moves on its own as its tasks do', () => {
  const issues = [issue('SAV-1'), issue('SAV-2'), issue('SAV-3', { stateType: 'completed' })];
  const s = plan(
    [task('a1', [], { issue: 'SAV-1', status: 'in_progress', substep: 'implementing' }), task('b1', [], { issue: 'SAV-2' }), task('c1', [], { issue: 'SAV-3', status: 'in_progress' })],
    issues,
  );
  const cfg = { team: 'SAV', statuses: { inReview: 'In Review' } };
  const writes = () => s.linear!.outbox.map((w) => w.dedupe);
  syncTickets(s, cfg);
  assert.deepEqual(writes(), ['status:SAV-1:inProgress'], 'only the started ticket moves; a done one is left alone');
  s.phases[0].tasks[0].substep = 'reviewing';
  syncTickets(s, cfg);
  assert.deepEqual(writes(), ['status:SAV-1:inProgress', 'status:SAV-1:inReview', 'comment:SAV-1:review']);
  syncTickets(s, cfg);
  assert.equal(s.linear!.outbox.length, 3, 'queued once');
  // A ticket whose only task jumps straight to done skips In Progress when review is configured.
  s.phases[0].tasks[1].status = 'done';
  syncTickets(s, cfg);
  assert.deepEqual(writes().slice(3), ['status:SAV-2:inReview', 'comment:SAV-2:review']);
  // Without a review status: In Progress and the comment.
  const t = plan([task('a1', [], { issue: 'SAV-1', status: 'done' })], [issue('SAV-1')]);
  syncTickets(t, { team: 'SAV' });
  assert.deepEqual(t.linear!.outbox.map((w) => w.dedupe), ['status:SAV-1:inProgress', 'comment:SAV-1:review']);
  // Outside the build nothing moves.
  const shipped = plan([task('a1', [], { issue: 'SAV-1', status: 'in_progress' })], [issue('SAV-1')]);
  shipped.stage = 'review';
  syncTickets(shipped, cfg);
  assert.equal(shipped.linear!.outbox.length, 0);
});

test('tickets: a plan loaded before tasks named their ticket keeps the old moves', () => {
  const s = plan([task('a1', ['FR-01'], { status: 'done' }), task('b1', ['FR-02'], { status: 'in_progress', substep: 'reviewing' })], [issue('SAV-1', { requirements: ['FR-01'] }), issue('SAV-2', { requirements: ['FR-02'] })]);
  syncTickets(s, { team: 'SAV', statuses: { inReview: 'In Review' } });
  assert.equal(s.linear!.outbox.length, 0, 'no per-ticket status moves');
  onPhaseFinished(s, { team: 'SAV' });
  assert.deepEqual(s.linear!.outbox.map((w) => w.dedupe), ['comment:SAV-1:built'], 'the phase-end comment on each built issue');
});

test('tickets: a ticket in a Completed-type review status still counts as not done for the merge', () => {
  const cfg = { team: 'SAV', statuses: { inReview: 'In Review' } };
  assert.equal(settled({ stateType: 'completed', stateName: 'In Review' }, cfg), false);
  assert.equal(settled({ stateType: 'completed', stateName: 'Done' }, cfg), true);
  assert.equal(settled({ stateType: 'completed', stateName: 'In Review' }, { team: 'SAV' }), true, 'no review status configured: completed is done');
  assert.equal(settled({ stateType: 'started', stateName: 'In Review' }, cfg), false);
});
