import { describe, expect, mock, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { isApproveLabel, parseTags } from '../mod/approve.ts'

const RAN = { stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const HASH_FILE = '/repo/.git/cairn/mod-secret.sha256'

type Run = { argv: readonly string[]; init?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } }
type Plan = { slug: string; stage: string; approvals?: Record<string, unknown>; phases?: unknown[]; worktree?: string; ready?: { kind: string } }

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The world beneath the mod: git names /repo/.git, `cairn status --all --json` lists
 * `plans`, and `cairn approve`/`--override` act as the CLI's proof does: the env's
 * CAIRN_APPROVER must hash to the last hash written, and a match spends it.
 */
type WorldOptions = { refuse?: string; cwd?: string; writable?: number; hangIn?: string }

function world(on: On, plans: Plan[], { refuse, cwd = '/repo', writable = Infinity, hangIn }: WorldOptions = {}) {
  const where = { cwd }
  const runs: Run[] = []
  const hashes: string[] = []
  const toasts: string[] = []
  let onDisk: string | undefined
  on('process.run', async (_$, e) => {
    runs.push({ argv: e.argv, init: e.init })
    const [bin, ...args] = e.argv
    const answer = (exitCode: number, stdout: string) => ({ value: { ...RAN, exitCode, stdout } })
    if (bin === 'git') return answer(0, '/repo/.git\n')
    if (bin === 'chmod') return answer(0, '')
    if (args.join(' ') === 'status --all --json') {
      // A plan at an unapproved stop is ready unless the fixture says `ready: undefined`.
      const rows = plans.map(p => {
        const { worktree, ready, ...rest } = p
        const atStop = ['prd', 'plan', 'ship'].includes(p.stage) && !p.approvals?.[p.stage]
        return {
          state: { approvals: {}, phases: [], ...rest },
          live: worktree !== undefined,
          worktree,
          next: {},
          ready: 'ready' in p ? ready : atStop ? { kind: p.stage } : undefined,
        }
      })
      return answer(0, JSON.stringify({ ok: true, plans: rows, modActive: true }))
    }
    const given = e.init?.env?.CAIRN_APPROVER
    if (hangIn !== undefined && e.init?.cwd === hangIn) return { deny: `timed out after ${e.init?.timeoutMs} ms` }
    if (refuse !== undefined) return answer(2, `✗ Refused: ${refuse}\n`)
    if (given !== undefined && onDisk !== undefined && (await sha256(given)) === onDisk) {
      onDisk = undefined
      return answer(0, args[0] === 'approve' ? `${args[1]} approved.\n` : 'Advanced (override recorded).\n')
    }
    return answer(2, '✗ Refused: no human proof\n')
  })
  on('fs.write', (_$, e) => {
    if (e.path === HASH_FILE && hashes.length >= writable) return { deny: 'EACCES: permission denied' }
    if (e.path === HASH_FILE) {
      hashes.push(e.text)
      onDisk = e.text
    }
    return { value: undefined }
  })
  on('session.cwd', () => ({ value: where.cwd }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const approveRuns = () => runs.filter(r => r.argv[1] === 'approve')
  const cliRuns = () => runs.filter(r => /\/bin\/cairn$/.test(r.argv[0] ?? '') && r.argv[1] !== 'status')
  return { runs, hashes, toasts, approveRuns, cliRuns, where }
}

/** The dialog beneath the mod: the user's `answers`, plus any `extra` fields of the result. */
function dialog(on: On, answers: Record<string, string>, extra: Record<string, unknown> = {}) {
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => ({
    result: { questions: e.questions, answers, ...extra } as never,
  }))
}

function ask(...questions: string[]) {
  return {
    tool: 'AskUserQuestion' as const,
    questions: questions.map(question => ({
      question,
      header: 'cairn',
      multiSelect: false,
      options: [
        { label: 'Approve (Recommended)', description: 'Approve it' },
        { label: 'Revise', description: 'Change it first' },
      ],
    })),
  }
}

describe('parseTags', () => {
  test('reads approve and override tags, with the question text they came from', () => {
    const questions = [
      { question: 'Approve the PRD? [cairn:approve prd alpha]' },
      { question: 'Skip the failing review? [cairn:override beta-2]' },
      { question: 'Which library?' },
    ]
    expect(parseTags(questions)).toEqual([
      { kind: 'prd', slug: 'alpha', question: 'Approve the PRD? [cairn:approve prd alpha]' },
      { slug: 'beta-2', question: 'Skip the failing review? [cairn:override beta-2]', override: true },
    ])
  })

  test('takes each of the three kinds and nothing else', () => {
    const tag = (kind: string) => ({ question: `ok? [cairn:approve ${kind} x]` })
    expect(parseTags(['prd', 'plan', 'ship'].map(tag)).map(t => t.kind)).toEqual(['prd', 'plan', 'ship'])
    expect(parseTags([tag('deploy'), tag('phase'), tag('PRD'), { question: '[cairn:approve prd]' }])).toEqual([])
  })

  test('ignores questions that are not strings', () => {
    expect(parseTags([{ question: undefined as never }, {} as never])).toEqual([])
  })
})

describe('isApproveLabel', () => {
  test('is true for a label starting Approve and for approving free text', () => {
    expect(isApproveLabel('Approve')).toBe(true)
    expect(isApproveLabel('Approve (Recommended)')).toBe(true)
    for (const label of ['Approve the revised wording', 'approve', 'Approved', 'LGTM', 'yes, ship it', 'Yes']) {
      expect(isApproveLabel(label)).toBe(true)
    }
    for (const label of ['Revise', 'Do not approve', 'yesterday', 'lgtmx', '', undefined]) {
      expect(isApproveLabel(label)).toBe(false)
    }
  })
})

describe('menu approval (FR-02)', () => {
  test('"Approve (Recommended)" on a tagged question at the matching stop approves with the secret', async ($, on) => {
    const { hashes, toasts, approveRuns } = world(on, [{ slug: 'happy', stage: 'prd', worktree: '/wt/happy' }])
    const q = 'Approve the PRD? [cairn:approve prd happy]'
    dialog(on, { [q]: 'Approve (Recommended)' })

    const got = await $.tool.call(ask(q))

    const [run] = approveRuns()
    expect(approveRuns()).toHaveLength(1)
    expect(run?.argv.slice(1)).toEqual(['approve', 'prd'])
    expect(run?.argv[0]).toMatch(/\/bin\/cairn$/)
    expect(run?.init?.cwd).toBe('/wt/happy')
    const secret = run?.init?.env?.CAIRN_APPROVER ?? ''
    expect(secret.length).toBeGreaterThanOrEqual(32)
    expect(hashes[0]).toBe(await sha256(secret))
    expect(hashes).not.toContain(secret)
    expect(got.result).toEqual({ questions: ask(q).questions, answers: { [q]: 'Approve (Recommended)' } })
    expect(got.context?.join('\n')).toMatch(/prd approved/)
    expect(toasts.join('\n')).toMatch(/prd approved/)
  })

  const unanswered: [string, string][] = [
    ['Request changes', /answer was not "Approve"/.source],
    ['Revise', /answer was not "Approve"/.source],
  ]
  for (const [answer, why] of unanswered) {
    test(`"${answer}" approves nothing and says why`, async ($, on) => {
      const { approveRuns, toasts } = world(on, [{ slug: 'wording', stage: 'prd', worktree: '/wt/wording' }])
      const q = 'Approve? [cairn:approve prd wording]'
      dialog(on, { [q]: answer })
      const got = await $.tool.call(ask(q))
      expect(approveRuns()).toEqual([])
      expect(got.context?.join('\n')).toMatch(new RegExp(why))
      expect(toasts).toEqual([])
    })
  }

  test('an auto-answered dialog (user away) approves nothing and says why', async ($, on) => {
    const { approveRuns } = world(on, [{ slug: 'afk', stage: 'prd', worktree: '/wt/afk' }])
    const q = 'Approve? [cairn:approve prd afk]'
    dialog(on, { [q]: 'Approve (Recommended)' }, { afkTimeoutMs: 60_000 })
    const got = await $.tool.call(ask(q))
    expect(approveRuns()).toEqual([])
    expect(got.context?.join('\n')).toMatch(/answered itself while you were away/)
  })

  test('a dismissed dialog approves nothing and says why', async ($, on) => {
    const { approveRuns } = world(on, [{ slug: 'dismissed', stage: 'prd', worktree: '/wt/dismissed' }])
    on('tool.call', { tool: 'AskUserQuestion' }, () => ({ deny: 'The user dismissed the question.' }))
    const q = 'Approve? [cairn:approve prd dismissed]'
    const got = await $.tool.call(ask(q))
    expect(approveRuns()).toEqual([])
    expect(got.deny).toBe('The user dismissed the question.')
  })

  test('answers the model put in the input are not the user\'s', async ($, on) => {
    const { approveRuns } = world(on, [{ slug: 'prefilled', stage: 'prd', worktree: '/wt/prefilled' }])
    const q = 'Approve? [cairn:approve prd prefilled]'
    dialog(on, { [q]: 'Approve' })
    const got = await $.tool.call({ ...ask(q), answers: { [q]: 'Approve' } })
    expect(approveRuns()).toEqual([])
    expect(got.context?.join('\n')).toMatch(/came from the model's call, not from you/)
  })

  test('a tag for a stop that is not waiting approves nothing and says why', async ($, on) => {
    const { approveRuns, toasts } = world(on, [{ slug: 'early', stage: 'plan', worktree: '/wt/early' }])
    const q = 'Approve? [cairn:approve prd early]'
    dialog(on, { [q]: 'Approve' })
    const got = await $.tool.call(ask(q))
    expect(approveRuns()).toEqual([])
    expect(got.context?.join('\n')).toMatch(/not waiting for prd approval/)
    expect(toasts.join('\n')).toMatch(/not waiting for prd approval/)
  })

  test('an approval that landed is reported even when the next secret cannot be written', async ($, on) => {
    const { approveRuns, toasts } = world(on, [{ slug: 'unwritable', stage: 'prd', worktree: '/wt/unwritable' }], { writable: 1 })
    const q = 'Approve? [cairn:approve prd unwritable]'
    dialog(on, { [q]: 'Approve' })
    const got = await $.tool.call(ask(q))
    expect(approveRuns()).toHaveLength(1)
    expect(got.context?.join()).toMatch(/prd approved/)
    expect(toasts.join()).toMatch(/prd approved/)
  })

  test('a phase tag is not a tag any more: nothing is approved', async ($, on) => {
    const { approveRuns } = world(on, [{ slug: 'ph', stage: 'execute', worktree: '/wt/ph' }])
    const q = 'Approve? [cairn:approve phase ph]'
    dialog(on, { [q]: 'Approve' })
    await $.tool.call(ask(q))
    expect(approveRuns()).toEqual([])
  })

  test('a refusal from cairn approve is carried in context and a toast', async ($, on) => {
    const { approveRuns, toasts } = world(on, [{ slug: 'refused', stage: 'ship', worktree: '/wt/refused' }], {
      refuse: 'review has not passed',
    })
    const q = 'Ship it? [cairn:approve ship refused]'
    dialog(on, { [q]: 'Approve' })
    const got = await $.tool.call(ask(q))
    expect(approveRuns()).toHaveLength(1)
    expect(got.context?.join('\n')).toMatch(/refused: .*review has not passed/)
    expect(toasts.join('\n')).toMatch(/refused: .*review has not passed/)
  })

  test('a subagent\'s dialog is left alone', async ($, on) => {
    const { approveRuns } = world(on, [{ slug: 'sub', stage: 'prd', worktree: '/wt/sub' }])
    const q = 'Approve? [cairn:approve prd sub]'
    dialog(on, { [q]: 'Approve' })
    const got = await $.tool.call({ ...ask(q), agentId: 'a1' } as never)
    expect(approveRuns()).toEqual([])
    expect(got.context).toBeUndefined()
  })

  test('answers core writes into the call while the dialog runs still count as the user\'s', async ($, on) => {
    const { approveRuns } = world(on, [{ slug: 'mutated', stage: 'prd', worktree: '/wt/mutated' }])
    const q = 'Approve? [cairn:approve prd mutated]'
    on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
      // The kit hands this hook a frozen event, so the write may not land; where it does,
      // the plugin must still judge the answers as they were before the dialog ran.
      Reflect.set(e, 'answers', { [q]: 'Approve' })
      return { result: { questions: e.questions, answers: { [q]: 'Approve' } } as never }
    })
    const got = await $.tool.call(ask(q))
    expect(approveRuns()).toHaveLength(1)
    expect(got.context?.join()).toMatch(/prd approved/)
  })

  test('FR-17: a stop tagged twice, answered Revise then Approve, records the approval', async ($, on) => {
    const { approveRuns, toasts } = world(on, [{ slug: 'shop', stage: 'prd', worktree: '/wt/shop' }])
    const a = 'Approve the PRD? [cairn:approve prd shop]'
    const b = 'Really approve the PRD? [cairn:approve prd shop]'
    dialog(on, { [a]: 'Revise', [b]: 'Approve (Recommended)' })
    const got = await $.tool.call(ask(a, b))
    expect(approveRuns()).toHaveLength(1)
    expect(got.context?.join('\n')).toMatch(/prd approved/)
    expect(toasts.join('\n')).toMatch(/prd approved/)
  })

  test('security: a stop tagged twice, Revise then a clicked "Yes" option, records no approval', async ($, on) => {
    const { approveRuns, toasts } = world(on, [{ slug: 'yes', stage: 'prd', worktree: '/wt/yes' }])
    const a = 'Approve the PRD? [cairn:approve prd yes]'
    const b = 'Really approve the PRD? [cairn:approve prd yes]'
    dialog(on, { [a]: 'Revise', [b]: 'Yes' })
    const call = ask(a, b)
    for (const q of call.questions) q.options.push({ label: 'Yes', description: 'Yes' })
    const got = await $.tool.call(call)
    expect(approveRuns()).toEqual([])
    expect(got.context?.join('\n')).not.toMatch(/prd approved/)
    expect(toasts).toEqual([])
  })

  test('FR-18: a question payload that is not a list passes through untouched', async ($, on) => {
    const { approveRuns, toasts } = world(on, [{ slug: 'odd', stage: 'prd', worktree: '/wt/odd' }])
    const answers = { 'Approve? [cairn:approve prd odd]': 'Approve' }
    const shape = { question: 'Approve? [cairn:approve prd odd]', options: [] }
    on('tool.call', { tool: 'AskUserQuestion' }, () => ({ result: { questions: shape, answers } as never }))
    const got = await $.tool.call({ tool: 'AskUserQuestion', questions: shape } as never)
    expect(got.deny).toBeUndefined()
    expect(got.result).toEqual({ questions: shape, answers })
    expect(got.context).toBeUndefined()
    expect(approveRuns()).toEqual([])
    expect(toasts).toEqual([])
  })

  test('a tag in a header or an option label is not a tag', async ($, on) => {
    const { approveRuns } = world(on, [{ slug: 'hidden', stage: 'prd', worktree: '/wt/hidden' }])
    const q = 'Ready?'
    dialog(on, { [q]: 'Approve' })
    const call = ask(q)
    const [first] = call.questions
    if (first !== undefined) {
      first.header = '[cairn:approve prd hidden]'
      first.options = [{ label: 'Approve', description: '[cairn:approve prd hidden]' }, { label: 'Revise', description: 'no' }]
    }
    const got = await $.tool.call(call)
    expect(approveRuns()).toEqual([])
    expect(got.context).toBeUndefined()
  })

  test('approve and status runs carry timeouts', async ($, on) => {
    const { runs } = world(on, [{ slug: 'timed', stage: 'prd', worktree: '/wt/timed' }])
    const q = 'Approve? [cairn:approve prd timed]'
    dialog(on, { [q]: 'Approve' })
    await $.tool.call(ask(q))
    const timeout = (pred: (r: Run) => boolean) => runs.filter(pred).map(r => r.init?.timeoutMs)
    // One read for the already-approved check before the dialog, one when the approval is judged.
    expect(timeout(r => r.argv[1] === 'status')).toEqual([60_000, 60_000])
    expect(timeout(r => r.argv[0] === 'chmod')).toEqual([60_000, 60_000])
    expect(timeout(r => r.argv[1] === 'approve')).toEqual([600_000])
  })

  test('an approve that times out is reported, and the next approval still gets a secret', async ($, on) => {
    const { approveRuns } = world(on, [
      { slug: 'hung', stage: 'prd', worktree: '/wt/hung' },
      { slug: 'after', stage: 'prd', worktree: '/wt/after' },
    ], { hangIn: '/wt/hung' })
    const hung = 'Approve? [cairn:approve prd hung]'
    const after = 'Approve? [cairn:approve prd after]'
    dialog(on, { [hung]: 'Approve', [after]: 'Approve' })
    const first = await $.tool.call(ask(hung))
    expect(first.context?.join()).toMatch(/hung prd approval failed: .*timed out/)
    const second = await $.tool.call(ask(after))
    expect(second.context?.join()).toMatch(/prd approved/)
    expect(approveRuns()).toHaveLength(2)
  })

  test('a throwing hook still returns the user\'s result (NFR-02)', async ($, on) => {
    on('process.run', () => ({ deny: 'EIO: cannot start' }))
    const q = 'Approve? [cairn:approve prd broken]'
    dialog(on, { [q]: 'Approve' })
    const got = await $.tool.call(ask(q))
    expect(got.deny).toBeUndefined()
    expect(got.result).toEqual({ questions: ask(q).questions, answers: { [q]: 'Approve' } })
  })
})

describe('ready gates approval (FR-11)', () => {
  test('a tagged Approve while ready is absent (the PRD is still being drafted) approves nothing', async ($, on) => {
    const { approveRuns } = world(on, [{ slug: 'drafting', stage: 'prd', worktree: '/wt/drafting', ready: undefined }])
    const q = 'Approve? [cairn:approve prd drafting]'
    dialog(on, { [q]: 'Approve' })
    const got = await $.tool.call(ask(q))
    expect(approveRuns()).toEqual([])
    expect(got.context?.join()).toMatch(/not waiting for prd approval/)
  })

  test('ready for another stop does not approve this one', async ($, on) => {
    const { approveRuns } = world(on, [{ slug: 'other', stage: 'prd', worktree: '/wt/other', ready: { kind: 'plan' } }])
    const q = 'Approve? [cairn:approve prd other]'
    dialog(on, { [q]: 'Approve' })
    await $.tool.call(ask(q))
    expect(approveRuns()).toEqual([])
  })
})

describe('already approved from the pane (FR-13, FR-15)', () => {
  const DONE = { at: 'x' }

  /** A dialog that counts how often it is shown. */
  function counted(on: On, answers: (qs: readonly { question: string }[]) => Record<string, string>) {
    const shown = { n: 0 }
    on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
      shown.n++
      return { result: { questions: e.questions, answers: answers(e.questions) } as never }
    })
    return shown
  }

  test('a tagged question for an approved stop is answered by the mod and never shown', async ($, on) => {
    const { approveRuns, toasts } = world(on, [{ slug: 'done', stage: 'plan', approvals: { prd: DONE }, worktree: '/wt/done', ready: { kind: 'plan' } }])
    const shown = counted(on, () => ({}))
    const q = 'Approve the PRD? [cairn:approve prd done]'
    const got = await $.tool.call(ask(q))
    expect(shown.n).toBe(0)
    expect(got.result).toEqual({ questions: ask(q).questions, answers: { [q]: 'Already approved from the pane' } })
    expect(approveRuns()).toEqual([])
    expect(got.context).toBeUndefined()
    expect(toasts).toEqual([])
  })

  test('several tagged questions, all approved, are all answered', async ($, on) => {
    world(on, [{ slug: 'done', stage: 'ship', approvals: { prd: DONE, plan: DONE }, worktree: '/wt/done', ready: { kind: 'ship' } }])
    const shown = counted(on, () => ({}))
    const a = 'PRD? [cairn:approve prd done]'
    const b = 'Plan? [cairn:approve plan done]'
    const got = await $.tool.call(ask(a, b))
    expect(shown.n).toBe(0)
    expect((got.result as { answers: object }).answers).toEqual({ [a]: 'Already approved from the pane', [b]: 'Already approved from the pane' })
  })

  test('a stop that is not approved is shown as usual', async ($, on) => {
    world(on, [{ slug: 'open', stage: 'prd', worktree: '/wt/open' }])
    const q = 'Approve? [cairn:approve prd open]'
    const shown = counted(on, () => ({ [q]: 'Revise' }))
    await $.tool.call(ask(q))
    expect(shown.n).toBe(1)
  })

  test('one approved tag among an unapproved one is shown', async ($, on) => {
    world(on, [{ slug: 'half', stage: 'plan', approvals: { prd: DONE }, worktree: '/wt/half' }])
    const a = 'PRD? [cairn:approve prd half]'
    const b = 'Plan? [cairn:approve plan half]'
    const shown = counted(on, () => ({ [a]: 'Revise', [b]: 'Revise' }))
    await $.tool.call(ask(a, b))
    expect(shown.n).toBe(1)
  })

  test('an untagged question beside an approved tag is shown, not swallowed', async ($, on) => {
    world(on, [{ slug: 'mixed', stage: 'plan', approvals: { prd: DONE }, worktree: '/wt/mixed' }])
    const a = 'PRD? [cairn:approve prd mixed]'
    const b = 'Which library?'
    const shown = counted(on, () => ({ [a]: 'Revise', [b]: 'Revise' }))
    await $.tool.call(ask(a, b))
    expect(shown.n).toBe(1)
  })

  test('an override question is never auto-answered', async ($, on) => {
    world(on, [{ slug: 'ov', stage: 'plan', approvals: { prd: DONE }, worktree: '/wt/ov' }])
    const q = 'Skip? [cairn:override ov]'
    const shown = counted(on, () => ({ [q]: 'No' }))
    await $.tool.call(ask(q))
    expect(shown.n).toBe(1)
  })

  test('a subagent\'s question is never auto-answered', async ($, on) => {
    world(on, [{ slug: 'sub', stage: 'plan', approvals: { prd: DONE }, worktree: '/wt/sub' }])
    const q = 'PRD? [cairn:approve prd sub]'
    const shown = counted(on, () => ({ [q]: 'Revise' }))
    await $.tool.call({ ...ask(q), agentId: 'a1' } as never)
    expect(shown.n).toBe(1)
  })

  test('a tag for a plan the CLI does not list is shown', async ($, on) => {
    world(on, [])
    const q = 'PRD? [cairn:approve prd ghost]'
    const shown = counted(on, () => ({ [q]: 'Revise' }))
    await $.tool.call(ask(q))
    expect(shown.n).toBe(1)
  })

  test('a failing status read shows the dialog and approves nothing', async ($, on) => {
    on('process.run', () => ({ deny: 'EIO: cannot start' }))
    const q = 'PRD? [cairn:approve prd broken]'
    const shown = counted(on, () => ({ [q]: 'Approve' }))
    const got = await $.tool.call(ask(q))
    expect(shown.n).toBe(1)
    expect(got.deny).toBeUndefined()
  })

  test('the model\'s prefilled answer on an unapproved stop still approves nothing', async ($, on) => {
    const { approveRuns } = world(on, [{ slug: 'pre', stage: 'prd', worktree: '/wt/pre' }])
    const q = 'Approve? [cairn:approve prd pre]'
    counted(on, () => ({ [q]: 'Approve' }))
    await $.tool.call({ ...ask(q), answers: { [q]: 'Approve' } })
    expect(approveRuns()).toEqual([])
  })

  test('FR-15: two tagged questions for one stop in one dialog yield one approval and one note', async ($, on) => {
    const { approveRuns, toasts } = world(on, [{ slug: 'twice', stage: 'prd', worktree: '/wt/twice' }])
    const a = 'Approve the PRD? [cairn:approve prd twice]'
    const b = 'Really approve the PRD? [cairn:approve prd twice]'
    counted(on, () => ({ [a]: 'Approve', [b]: 'Approve' }))
    const got = await $.tool.call(ask(a, b))
    expect(approveRuns()).toHaveLength(1)
    expect(got.context).toHaveLength(1)
    expect(toasts).toHaveLength(1)
  })

  test('an approval that is already recorded, answered Approve in a shown dialog, says nothing', async ($, on) => {
    const { approveRuns, toasts } = world(on, [{ slug: 'late', stage: 'plan', approvals: { prd: DONE }, worktree: '/wt/late' }])
    const a = 'PRD? [cairn:approve prd late]'
    const b = 'Which library?'
    counted(on, () => ({ [a]: 'Approve', [b]: 'x' }))
    const got = await $.tool.call(ask(a, b))
    expect(approveRuns()).toEqual([])
    expect(got.context).toBeUndefined()
    expect(toasts).toEqual([])
  })
})

describe('the secret (FR-01, Review focus 1 and 2)', () => {
  test('the hash is written with mode 0600 before the secret is used, and again after', async ($, on) => {
    const { hashes, runs, approveRuns } = world(on, [{ slug: 'mode', stage: 'prd', worktree: '/wt/mode' }])
    const q = 'Approve? [cairn:approve prd mode]'
    dialog(on, { [q]: 'Approve' })
    await $.tool.call(ask(q))
    const order = runs.map(r => (r.argv[1] === 'approve' ? 'approve' : r.argv.join(' ')))
    const chmod = `chmod 600 ${HASH_FILE}`
    expect(order.slice(order.indexOf('approve') - 1, order.indexOf('approve') + 1)).toEqual([chmod, 'approve'])
    expect(order.slice(order.indexOf('approve') + 1).filter(c => c === chmod)).toHaveLength(1)
    expect(hashes).toHaveLength(2)
    expect(hashes[1]).not.toBe(hashes[0])
    expect(approveRuns()).toHaveLength(1)
  })

  test('with two plans waiting, the tag\'s slug picks the plan that is approved', async ($, on) => {
    const { approveRuns } = world(on, [
      { slug: 'first', stage: 'prd', worktree: '/wt/first' },
      { slug: 'second', stage: 'prd', worktree: '/wt/second' },
    ])
    const q = 'Approve the PRD? [cairn:approve prd second]'
    dialog(on, { [q]: 'Approve' })
    await $.tool.call(ask(q))
    expect(approveRuns().map(r => r.init?.cwd)).toEqual(['/wt/second'])
  })

  test('back-to-back approvals each use the rotated secret, and both land', async ($, on) => {
    const { approveRuns, hashes } = world(on, [
      { slug: 'one', stage: 'prd', worktree: '/wt/one' },
      { slug: 'two', stage: 'plan', worktree: '/wt/two' },
    ])
    const one = 'Approve? [cairn:approve prd one]'
    const two = 'Approve? [cairn:approve plan two]'
    dialog(on, { [one]: 'Approve', [two]: 'Approve' })
    const first = await $.tool.call(ask(one))
    const second = await $.tool.call(ask(two))
    const [a, b] = approveRuns().map(r => r.init?.env?.CAIRN_APPROVER ?? '')
    expect(a).not.toBe(b)
    expect(hashes).toContain(await sha256(a ?? ''))
    expect(hashes).toContain(await sha256(b ?? ''))
    expect(first.context?.join()).toMatch(/prd approved/)
    expect(second.context?.join()).toMatch(/plan approved/)
  })

  test('approvals that land at once take turns with the secret, and both land', async ($, on) => {
    world(on, [
      { slug: 'c1', stage: 'prd', worktree: '/wt/c1' },
      { slug: 'c2', stage: 'ship', worktree: '/wt/c2' },
    ])
    const one = 'Approve? [cairn:approve prd c1]'
    const two = 'Ship? [cairn:approve ship c2]'
    dialog(on, { [one]: 'Approve', [two]: 'Approve' })
    const [first, second] = await Promise.all([$.tool.call(ask(one)), $.tool.call(ask(two))])
    expect(first.context?.join()).toMatch(/prd approved/)
    expect(second.context?.join()).toMatch(/ship approved/)
  })
})

describe('mod-run overrides (FR-34)', () => {
  const ADVANCE = 'cairn advance --override "r"'

  /** The Bash tool beneath the mod: records what it ran. */
  function shell(on: On) {
    const ran: string[] = []
    on('tool.call', { tool: 'Bash' }, (_$, e) => {
      ran.push(e.command)
      return { result: { stdout: 'shell ran it', stderr: '', interrupted: false } }
    })
    return ran
  }

  async function grantOverride($: Engine, on: On, slug: string, answer = 'Override') {
    const q = `Override the review? [cairn:override ${slug}]`
    dialog(on, { [q]: answer })
    return $.tool.call(ask(q))
  }

  test('after an exact "Override", the next plain cairn --override is run by the mod with the secret', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    const { cliRuns, hashes } = world(on, [{ slug: 'ov', stage: 'review', worktree: '/wt/ov' }])
    const ran = shell(on)
    const granted = await grantOverride($, on, 'ov')
    expect(granted.context?.join()).toMatch(/override for "ov" is ready/)

    const got = await $.tool.call({ tool: 'Bash', command: ADVANCE })

    expect(ran).toEqual([])
    const [run] = cliRuns()
    expect(cliRuns()).toHaveLength(1)
    expect(run?.argv.slice(1)).toEqual(['advance', '--override', 'r'])
    expect(run?.init?.cwd).toBe('/wt/ov')
    expect(hashes).toContain(await sha256(run?.init?.env?.CAIRN_APPROVER ?? ''))
    expect(got.result).toEqual({ stdout: 'Advanced (override recorded).\n', stderr: '', interrupted: false })

    // Spent: the next one runs as the model wrote it, and the CLI refuses it there.
    await $.tool.call({ tool: 'Bash', command: ADVANCE })
    expect(ran).toEqual([ADVANCE])
    expect(cliRuns()).toHaveLength(1)
  })

  for (const answer of ['Override?', 'override']) {
    test(`"${answer}" leaves no override pending`, async ($, on) => {
      mock.clock(on)
      const { cliRuns } = world(on, [{ slug: `ov-${answer.length}`, stage: 'review', worktree: '/wt/x' }])
      const ran = shell(on)
      await grantOverride($, on, `ov-${answer.length}`, answer)
      await $.tool.call({ tool: 'Bash', command: ADVANCE })
      expect(cliRuns()).toEqual([])
      expect(ran).toEqual([ADVANCE])
    })
  }

  const unplain = [
    'cairn advance --override "r"; rm -rf x',
    'cairn advance --override r && echo ok',
    'cairn advance --override r | tee log',
    'cairn advance --override r > log',
    'cairn advance --override "r',
    'cd /wt/x && cairn advance --override r',
  ]
  for (const command of unplain) {
    test(`not run by the mod: ${command}`, async ($, on) => {
      mock.clock(on)
      const slug = `unplain-${unplain.indexOf(command)}`
      const { cliRuns } = world(on, [{ slug, stage: 'review', worktree: '/wt/u' }])
      const ran = shell(on)
      await grantOverride($, on, slug)
      const got = await $.tool.call({ tool: 'Bash', command })
      expect(cliRuns()).toEqual([])
      expect(ran).toEqual([command])
      expect(got.context?.join()).toMatch(/not a plain cairn --override command/)
    })
  }

  test('any character inside quotes is one argument: the mod runs argv, never a shell', async ($, on) => {
    mock.clock(on)
    const { cliRuns } = world(on, [{ slug: 'quoted', stage: 'review', worktree: '/wt/quoted' }])
    shell(on)
    await grantOverride($, on, 'quoted')
    await $.tool.call({ tool: 'Bash', command: 'cairn advance --override "r; $(whoami) `x`\nnext" --note \'a | b > c\'' })
    expect(cliRuns().map(r => r.argv.slice(1))).toEqual([['advance', '--override', 'r; $(whoami) `x`\nnext', '--note', 'a | b > c']])
  })

  test('a quoted reason glued to --override= is one argument, as a shell reads it', async ($, on) => {
    mock.clock(on)
    const { cliRuns } = world(on, [{ slug: 'glued', stage: 'review', worktree: '/wt/glued' }])
    shell(on)
    await grantOverride($, on, 'glued')
    await $.tool.call({ tool: 'Bash', command: `cairn advance --override="user's call" --note 'two words'` })
    expect(cliRuns().map(r => r.argv.slice(1))).toEqual([['advance', "--override=user's call", '--note', 'two words']])
  })

  test('an override pending more than 10 minutes is not used', async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    const { cliRuns } = world(on, [{ slug: 'stale', stage: 'review', worktree: '/wt/stale' }])
    const ran = shell(on)
    await grantOverride($, on, 'stale')
    await clock.advance(10 * 60_000 + 1)
    await $.tool.call({ tool: 'Bash', command: ADVANCE })
    expect(cliRuns()).toEqual([])
    expect(ran).toEqual([ADVANCE])
  })

  test('a pending override does not turn cairn approve into an approval', async ($, on) => {
    mock.clock(on)
    const { approveRuns } = world(on, [{ slug: 'sneak', stage: 'prd', worktree: '/wt/sneak' }])
    const ran = shell(on)
    await grantOverride($, on, 'sneak')
    const got = await $.tool.call({ tool: 'Bash', command: 'cairn approve prd --override "r"' })
    expect(approveRuns()).toEqual([])
    expect(ran).toEqual([])
    expect(got.deny).toMatch(/approvals and plan state come from the user/)
  })

  test('a session inside another plan\'s worktree runs the command normally', async ($, on) => {
    mock.clock(on)
    const { cliRuns } = world(on, [
      { slug: 'granted', stage: 'review', worktree: '/wt/granted' },
      { slug: 'other', stage: 'review', worktree: '/wt/other' },
    ], { cwd: '/wt/other/src' })
    const ran = shell(on)
    await grantOverride($, on, 'granted')
    await $.tool.call({ tool: 'Bash', command: ADVANCE })
    expect(cliRuns()).toEqual([])
    expect(ran).toEqual([ADVANCE])
  })

  const strange = ['*', '?', '~', '#', '(', ')', '{', '}', '[', ']']
  for (const c of strange) {
    test(`not run by the mod: an unquoted ${c}`, async ($, on) => {
      mock.clock(on)
      const slug = `strange-${strange.indexOf(c)}`
      const { cliRuns } = world(on, [{ slug, stage: 'review', worktree: '/wt/s' }])
      const ran = shell(on)
      await grantOverride($, on, slug)
      const command = `cairn advance --override r${c}x`
      const got = await $.tool.call({ tool: 'Bash', command })
      expect(cliRuns()).toEqual([])
      expect(ran).toEqual([command])
      expect(got.context?.join()).toMatch(/not a plain cairn --override command/)
    })
  }

  test('the same characters inside quotes are part of the reason', async ($, on) => {
    mock.clock(on)
    const { cliRuns } = world(on, [{ slug: 'quoted', stage: 'review', worktree: '/wt/quoted' }])
    shell(on)
    await grantOverride($, on, 'quoted')
    await $.tool.call({ tool: 'Bash', command: `cairn advance --override "fix (later) [#3] ~ok* {a,b}?"` })
    expect(cliRuns().map(r => r.argv.slice(1))).toEqual([['advance', '--override', 'fix (later) [#3] ~ok* {a,b}?']])
  })

  // A hook can't set a Bash result's is_error (core ignores it, and a string result fails the
  // output schema), so a failure leads stdout with "Exit code N", as the Bash tool's own does.
  test('a non-zero exit leads the result with the exit code and the CLI output', async ($, on) => {
    mock.clock(on)
    world(on, [{ slug: 'fails', stage: 'review', worktree: '/wt/fails' }], { refuse: 'review has not passed' })
    shell(on)
    await grantOverride($, on, 'fails')
    const got = await $.tool.call({ tool: 'Bash', command: ADVANCE })
    const result = got.result as { stdout: string }
    expect(result.stdout).toMatch(/^Exit code 2\n[\s\S]*review has not passed/)
    expect(got.context?.join()).toMatch(/exit code 2/)
  })

  test('override runs carry timeouts, and one that times out is reported and frees the secret', async ($, on) => {
    mock.clock(on)
    const { cliRuns, approveRuns } = world(on, [
      { slug: 'ov-hung', stage: 'review', worktree: '/wt/ov-hung' },
      { slug: 'ov-next', stage: 'prd', worktree: '/wt/ov-next' },
    ], { hangIn: '/wt/ov-hung' })
    const ran = shell(on)
    const o = 'Override the review? [cairn:override ov-hung]'
    const q = 'Approve? [cairn:approve prd ov-next]'
    dialog(on, { [o]: 'Override', [q]: 'Approve' })
    await $.tool.call(ask(o))
    const got = await $.tool.call({ tool: 'Bash', command: ADVANCE })
    expect(cliRuns().map(r => r.init?.timeoutMs)).toEqual([600_000])
    expect((got.result as { stdout: string }).stdout).toMatch(/^cairn: the override run failed: .*timed out/)
    expect(ran).toEqual([])
    expect((await $.tool.call(ask(q))).context?.join()).toMatch(/prd approved/)
    expect(approveRuns()).toHaveLength(1)
  })

  test('an "Override" the model pre-filled leaves nothing pending', async ($, on) => {
    mock.clock(on)
    const { cliRuns } = world(on, [{ slug: 'pre', stage: 'review', worktree: '/wt/pre' }])
    const ran = shell(on)
    const q = 'Override? [cairn:override pre]'
    dialog(on, { [q]: 'Override' })
    await $.tool.call({ ...ask(q), answers: { [q]: 'Override' } })
    await $.tool.call({ tool: 'Bash', command: ADVANCE })
    expect(cliRuns()).toEqual([])
    expect(ran).toEqual([ADVANCE])
  })

  test('an "Override" the dialog gave while the user was away leaves nothing pending', async ($, on) => {
    mock.clock(on)
    const { cliRuns } = world(on, [{ slug: 'away', stage: 'review', worktree: '/wt/away' }])
    const ran = shell(on)
    const q = 'Override? [cairn:override away]'
    dialog(on, { [q]: 'Override' }, { afkTimeoutMs: 60_000 })
    await $.tool.call(ask(q))
    await $.tool.call({ tool: 'Bash', command: ADVANCE })
    expect(cliRuns()).toEqual([])
    expect(ran).toEqual([ADVANCE])
  })

  test('a subagent\'s Override answer and a subagent\'s override command are left alone', async ($, on) => {
    mock.clock(on)
    const { cliRuns } = world(on, [{ slug: 'agent', stage: 'review', worktree: '/wt/agent' }])
    const ran = shell(on)
    const q = 'Override the review? [cairn:override agent]'
    dialog(on, { [q]: 'Override' })
    await $.tool.call({ ...ask(q), agentId: 'a1' } as never)
    await $.tool.call({ tool: 'Bash', command: ADVANCE })
    expect(cliRuns()).toEqual([])
    await $.tool.call(ask(q))
    await $.tool.call({ tool: 'Bash', command: ADVANCE, agentId: 'a1' } as never)
    expect(cliRuns()).toEqual([])
    expect(ran).toEqual([ADVANCE, ADVANCE])
  })

  test('with two plans holding overrides, each command runs only for the plan the session is in', async ($, on) => {
    mock.clock(on)
    const { cliRuns, where } = world(on, [
      { slug: 'pa', stage: 'review', worktree: '/wt/pa' },
      { slug: 'pb', stage: 'review', worktree: '/wt/pb' },
    ])
    const ran = shell(on)
    const a = 'Override? [cairn:override pa]'
    const b = 'Override? [cairn:override pb]'
    dialog(on, { [a]: 'Override', [b]: 'Override' })
    await $.tool.call(ask(a, b))
    const fromRoot = await $.tool.call({ tool: 'Bash', command: ADVANCE })
    expect(fromRoot.context?.join()).toMatch(/several plans/)
    where.cwd = '/wt/pb'
    await $.tool.call({ tool: 'Bash', command: ADVANCE })
    where.cwd = '/wt/pa/src'
    await $.tool.call({ tool: 'Bash', command: ADVANCE })
    expect(cliRuns().map(r => r.init?.cwd)).toEqual(['/wt/pb', '/wt/pa'])
    expect(ran).toEqual([ADVANCE])
  })

  test('the secret never reaches the model or the user', async ($, on) => {
    mock.clock(on)
    const { cliRuns, toasts } = world(on, [
      { slug: 'leak-a', stage: 'prd', worktree: '/wt/leak-a' },
      { slug: 'leak-o', stage: 'review', worktree: '/wt/leak-o' },
    ])
    shell(on)
    const q = 'Approve? [cairn:approve prd leak-a]'
    const o = 'Override? [cairn:override leak-o]'
    dialog(on, { [q]: 'Approve', [o]: 'Override' })
    const seen = [JSON.stringify(await $.tool.call(ask(q, o))), JSON.stringify(await $.tool.call({ tool: 'Bash', command: ADVANCE }))]
    const secrets = cliRuns().map(r => r.init?.env?.CAIRN_APPROVER ?? '')
    expect(secrets).toHaveLength(2)
    for (const secret of secrets) {
      expect(secret).not.toBe('')
      for (const text of [...seen, ...toasts]) expect(text.includes(secret)).toBe(false)
    }
  })

  test('with nothing pending, a Bash call goes straight through', async ($, on) => {
    const { runs } = world(on, [])
    const ran = shell(on)
    const got = await $.tool.call({ tool: 'Bash', command: ADVANCE })
    expect(ran).toEqual([ADVANCE])
    expect(runs).toEqual([])
    expect(got.context).toBeUndefined()
  })
})
