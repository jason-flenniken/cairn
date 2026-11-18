import { describe, expect, mock, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { ALREADY_APPROVED, isApproveLabel, parseTags } from '../mod/approve.ts'

const RAN = { stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const TOKEN_PREFIX = '/repo/.git/cairn/approver-'

type Run = { argv: readonly string[]; init?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } }
type Plan = { slug: string; stage: string; approvals?: Record<string, unknown>; phases?: unknown[]; worktree?: string; ready?: { kind: string }; readyError?: string }

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The world beneath the mod: git names /repo/.git, `cairn status --all --json` lists
 * `plans`, and `cairn approve` acts as the CLI's proof does: the env's
 * CAIRN_APPROVER must hash to the last hash written, and a match spends it.
 */
/** `elsewhere`: with `refuse`, the stop is approved by another path just before the refused run. */
type WorldOptions = { refuse?: string; cwd?: string; writable?: number; hangIn?: string; elsewhere?: true }

function world(on: On, plans: Plan[], { refuse, cwd = '/repo', writable = Infinity, hangIn, elsewhere }: WorldOptions = {}) {
  const where = { cwd }
  const runs: Run[] = []
  const hashes: string[] = []
  const toasts: string[] = []
  // `hangIn`: the first CLI run in that folder times out; later ones answer.
  let hasHung = false
  // The approver files on disk, by the hash that names each.
  const live = new Set<string>()
  on('process.run', async (_$, e) => {
    runs.push({ argv: e.argv, init: e.init })
    const [bin, ...args] = e.argv
    const answer = (exitCode: number, stdout: string) => ({ value: { ...RAN, exitCode, stdout } })
    if (bin === 'git') return answer(0, '/repo/.git\n')
    if (bin === 'chmod') return answer(0, '')
    if (bin === 'rm') {
      live.delete(e.argv[2]?.slice(TOKEN_PREFIX.length) ?? '')
      return answer(0, '')
    }
    if (args.join(' ') === 'status --all --json') {
      // A plan at an unapproved stop is ready unless the fixture says `ready: undefined`.
      const rows = plans.map(p => {
        const { worktree, ready, readyError, ...rest } = p
        const atStop = p.stage === 'prd' && !p.approvals?.prd
        return {
          state: { approvals: {}, phases: [], ...rest },
          live: worktree !== undefined,
          worktree,
          next: {},
          ready: 'ready' in p ? ready : atStop ? { kind: p.stage } : undefined,
          ...(readyError !== undefined ? { readyError } : {}),
        }
      })
      return answer(0, JSON.stringify({ ok: true, plans: rows, modActive: true }))
    }
    const given = e.init?.env?.CAIRN_APPROVER
    if (hangIn !== undefined && e.init?.cwd === hangIn && !hasHung) {
      hasHung = true
      return { deny: `timed out after ${e.init?.timeoutMs} ms` }
    }
    if (refuse !== undefined) {
      const at = plans.find(p => p.worktree === e.init?.cwd)
      if (elsewhere && at !== undefined && args[0] === 'approve') at.approvals = { ...at.approvals, [args[1] as string]: { via: 'human' } }
      return answer(2, `✗ Refused: ${refuse}\n`)
    }
    if (args[0] === 'level') {
      if (given !== undefined && live.delete(await sha256(given))) {
        return answer(0, `Level raised to ${args[1]}.\n`)
      }
      return answer(2, '✗ Refused: no human proof\n')
    }
    if (given !== undefined && live.delete(await sha256(given))) {
      return answer(0, `${args[1]} approved.\n`)
    }
    return answer(2, '✗ Refused: no human proof\n')
  })
  on('fs.write', (_$, e) => {
    if (!e.path.startsWith(TOKEN_PREFIX)) return { value: undefined }
    if (hashes.length >= writable) return { deny: 'EACCES: permission denied' }
    const hash = e.path.slice(TOKEN_PREFIX.length)
    hashes.push(hash)
    live.add(hash)
    return { value: undefined }
  })
  on('session.cwd', () => ({ value: where.cwd }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const approveRuns = () => runs.filter(r => r.argv[1] === 'approve')
  const levelRuns = () => runs.filter(r => r.argv[1] === 'level')
  const cliRuns = () => runs.filter(r => /\/bin\/cairn$/.test(r.argv[0] ?? '') && r.argv[1] !== 'status')
  return { runs, hashes, toasts, approveRuns, levelRuns, cliRuns, where, live }
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
  test('reads a PRD approval tag, with the question text it came from', () => {
    const questions = [
      { question: 'Approve the PRD? [cairn:approve prd alpha]' },
      { question: 'Which library?' },
    ]
    expect(parseTags(questions)).toEqual([
      { kind: 'prd', slug: 'alpha', question: 'Approve the PRD? [cairn:approve prd alpha]' },
    ])
  })

  test('takes the PRD kind and nothing else: plan, ship, commands and override tags are not cairn tags', () => {
    const tag = (kind: string) => ({ question: `ok? [cairn:approve ${kind} x]` })
    expect(parseTags([tag('prd')]).map(t => t.kind)).toEqual(['prd'])
    expect(parseTags([tag('plan'), tag('ship'), tag('commands'), tag('deploy'), tag('phase'), tag('PRD'), { question: '[cairn:approve prd]' }, { question: 'Skip? [cairn:override x]' }])).toEqual([])
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

  test('a stop whose ready check failed approves nothing and says the reason', async ($, on) => {
    const { approveRuns, toasts } = world(on, [{ slug: 'shop', stage: 'prd', worktree: '/wt/shop', ready: undefined, readyError: 'git ls-files failed' }])
    const q = 'Approve? [cairn:approve prd shop]'
    dialog(on, { [q]: 'Approve' })
    const got = await $.tool.call(ask(q))
    expect(approveRuns()).toEqual([])
    expect(got.context?.join('\n')).toMatch(/could not be checked for prd approval \(git ls-files failed\)/)
    expect(toasts.join('\n')).toMatch(/git ls-files failed/)
  })

  test('a secret file that cannot be written runs nothing and says the approval failed', async ($, on) => {
    const { approveRuns, toasts } = world(on, [{ slug: 'unwritable', stage: 'prd', worktree: '/wt/unwritable' }], { writable: 0 })
    const q = 'Approve? [cairn:approve prd unwritable]'
    dialog(on, { [q]: 'Approve' })
    const got = await $.tool.call(ask(q))
    expect(approveRuns()).toEqual([])
    expect(got.context?.join()).toMatch(/unwritable prd approval failed: .*EACCES/)
    expect(toasts.join()).toMatch(/approval failed/)
  })

  test('a phase tag is not a tag any more: nothing is approved', async ($, on) => {
    const { approveRuns } = world(on, [{ slug: 'ph', stage: 'execute', worktree: '/wt/ph' }])
    const q = 'Approve? [cairn:approve phase ph]'
    dialog(on, { [q]: 'Approve' })
    await $.tool.call(ask(q))
    expect(approveRuns()).toEqual([])
  })

  test('a refusal from cairn approve is carried in context and a toast', async ($, on) => {
    const { approveRuns, toasts } = world(on, [{ slug: 'refused', stage: 'prd', worktree: '/wt/refused' }], {
      refuse: 'review has not passed',
    })
    const q = 'Approve? [cairn:approve prd refused]'
    dialog(on, { [q]: 'Approve' })
    const got = await $.tool.call(ask(q))
    expect(approveRuns()).toHaveLength(1)
    expect(got.context?.join('\n')).toMatch(/refused: .*review has not passed/)
    expect(toasts.join('\n')).toMatch(/refused: .*review has not passed/)
  })

  test('a refusal for lack of proof says the session runs an outdated cairn and never points at the terminal', async ($, on) => {
    const { toasts } = world(on, [{ slug: 'old', stage: 'prd', worktree: '/wt/old' }], {
      refuse: 'approvals come from the user, and this command has no proof that one did',
    })
    on('fs.read', (_$, e) => (e.path.endsWith('/.claude-plugin/plugin.json') ? { value: JSON.stringify({ name: 'cairn', version: '0.22.1' }) as never } : { deny: 'ENOENT' }))
    const q = 'Approve? [cairn:approve prd old]'
    dialog(on, { [q]: 'Approve' })
    const got = await $.tool.call(ask(q))
    const said = got.context?.join('\n') ?? ''
    expect(said).toContain("cairn: old prd approval was not recorded: the CLI got no proof from this session's cairn (version 0.22.1). This usually means the session runs an outdated cairn: restart the session, then ask the approval menu again. Do not send the user to the terminal.")
    expect(said).not.toContain('refused')
    expect(toasts.join('\n')).toContain('was not recorded')
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

  test('FR-11: a stop tagged twice, both answered Revise, shows one "not approved" note', async ($, on) => {
    const { approveRuns } = world(on, [{ slug: 'twice', stage: 'prd', worktree: '/wt/twice' }])
    const a = 'Approve the PRD? [cairn:approve prd twice]'
    const b = 'Really approve the PRD? [cairn:approve prd twice]'
    dialog(on, { [a]: 'Revise', [b]: 'Revise' })
    const got = await $.tool.call(ask(a, b))
    expect(approveRuns()).toEqual([])
    expect(got.context?.filter(c => /not approved/.test(c))).toHaveLength(1)
  })

  /**
   * A first dialog that stays open (and can later fail), then a second that answers `second` as the user:
   * the second's approval is what the open one must notice. `open` is the first call's promise.
   */
  function openThenAnswered(on: On, second: Record<string, string>) {
    let calls = 0
    let fail: (err: Error) => void = () => {}
    on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) =>
      ++calls === 1
        ? new Promise<never>((_, reject) => (fail = reject))
        : { result: { questions: e.questions, answers: second } as never },
    )
    return { fail: (err: Error) => fail(err) }
  }

  const settleSoon = () => new Promise(r => setTimeout(r, 20))

  test('FR-12: approving a stop while its question is open answers the question, with no second approval run', async ($, on) => {
    const { approveRuns } = world(on, [{ slug: 'live', stage: 'prd', worktree: '/wt/live' }])
    const q = 'Approve the PRD? [cairn:approve prd live]'
    openThenAnswered(on, { [q]: 'Approve' })
    const open = $.tool.call(ask(q))
    let settled = false
    void open.then(() => (settled = true), () => undefined)
    await settleSoon()
    expect(settled).toBe(false)
    const approving = await $.tool.call(ask(q))
    expect(approving.context?.join()).toMatch(/prd approved/)
    const got = await open
    expect(got.result).toEqual({ questions: ask(q).questions, answers: { [q]: ALREADY_APPROVED } })
    expect(got.context).toBeUndefined()
    expect(approveRuns()).toHaveLength(1)
  })

  test('FR-12: approving another plan leaves an open question pending', async ($, on) => {
    world(on, [
      { slug: 'a', stage: 'prd', worktree: '/wt/a' },
      { slug: 'b', stage: 'prd', worktree: '/wt/b' },
    ])
    const qb = 'Approve? [cairn:approve prd b]'
    openThenAnswered(on, { [qb]: 'Approve' })
    const open = $.tool.call(ask('Approve? [cairn:approve prd a]'))
    let settled = false
    void open.then(() => (settled = true), () => undefined)
    await $.tool.call(ask(qb))
    await settleSoon()
    expect(settled).toBe(false)
  })

  test('FR-12: a refused approve run never answers an open question', async ($, on) => {
    const { approveRuns } = world(on, [{ slug: 'nope', stage: 'prd', worktree: '/wt/nope' }], { refuse: 'no' })
    const q = 'Approve? [cairn:approve prd nope]'
    openThenAnswered(on, { [q]: 'Approve' })
    const open = $.tool.call(ask(q))
    let settled = false
    void open.then(() => (settled = true), () => undefined)
    await settleSoon()
    const refused = await $.tool.call(ask(q))
    expect(approveRuns()).toHaveLength(1)
    expect(refused.context?.join()).toMatch(/refused/)
    await settleSoon()
    expect(settled).toBe(false)
  })

  test('FR-12: the abandoned dialog failing after the early answer changes nothing', async ($, on) => {
    world(on, [{ slug: 'late', stage: 'prd', worktree: '/wt/late' }])
    const q = 'Approve? [cairn:approve prd late]'
    const { fail } = openThenAnswered(on, { [q]: 'Approve' })
    const open = $.tool.call(ask(q))
    await settleSoon()
    await $.tool.call(ask(q))
    const got = await open
    fail(new Error('dialog gone'))
    await settleSoon()
    expect((got.result as { answers: unknown }).answers).toEqual({ [q]: ALREADY_APPROVED })
  })

  test('FR-19: approving a stop in the pane while its question is open shows a toast, since the answered line goes at once', async ($, on) => {
    const { toasts } = world(on, [{ slug: 'noticed', stage: 'prd', worktree: '/wt/noticed' }])
    const q = 'Approve? [cairn:approve prd noticed]'
    const notices: unknown[] = []
    on('ui.notice', (_$, e) => {
      notices.push(e)
      return { value: undefined }
    })
    openThenAnswered(on, { [q]: 'Approve' })
    const open = $.tool.call(ask(q))
    await settleSoon()
    await $.tool.call(ask(q))
    const got = await open
    expect(toasts.filter(t => t === 'Approved in the pane')).toHaveLength(1)
    expect(notices).toEqual([])
    expect((got.result as { answers: unknown }).answers).toEqual({ [q]: ALREADY_APPROVED })
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
    // One read before the dialog (the session's plan and the already-approved check), one when the approval is judged.
    expect(timeout(r => r.argv[1] === 'status')).toEqual([60_000, 60_000])
    expect(timeout(r => r.argv[0] === 'chmod')).toEqual([60_000])
    expect(timeout(r => r.argv[0] === 'rm')).toEqual([60_000])
    expect(timeout(r => r.argv[1] === 'approve')).toEqual([600_000])
  })

  test('an approve that times out is reported, and the next approval still gets a secret', async ($, on) => {
    const { approveRuns } = world(on, [{ slug: 'hung', stage: 'prd', worktree: '/wt/hung' }], { hangIn: '/wt/hung' })
    const hung = 'Approve? [cairn:approve prd hung]'
    dialog(on, { [hung]: 'Approve' })
    const first = await $.tool.call(ask(hung))
    expect(first.context?.join()).toMatch(/hung prd approval failed: .*timed out/)
    const second = await $.tool.call(ask(hung))
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

  test('a PRD edited after its approval waits again: a prd tag approves it, though approvals.prd exists', async ($, on) => {
    const { approveRuns } = world(on, [{ slug: 'edited', stage: 'execute', worktree: '/wt/edited', approvals: { prd: { via: 'human' } }, ready: { kind: 'prd' } }])
    const q = 'Approve the edited PRD? [cairn:approve prd edited]'
    const shown = { n: 0 }
    on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
      shown.n++
      return { result: { questions: e.questions, answers: { [q]: 'Approve (Recommended)' } } as never }
    })
    const got = await $.tool.call(ask(q))
    // Not "already approved": the dialog is shown, and the answer runs the approval.
    expect(shown.n).toBe(1)
    expect(approveRuns().map(r => r.argv.slice(1))).toEqual([['approve', 'prd']])
    expect(got.context?.join('\n')).toMatch(/prd approved/)
  })

  for (const tag of ['[cairn:approve plan x]', '[cairn:approve ship x]', '[cairn:approve commands x]', '[cairn:override x]']) {
    test(`${tag} is not a cairn tag: the question passes through with no CLI run`, async ($, on) => {
      const { cliRuns, toasts } = world(on, [{ slug: 'x', stage: 'execute', worktree: '/wt/x', approvals: { prd: { via: 'human' } } }])
      const q = `Go ahead? ${tag}`
      const shown = { n: 0 }
      on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
        shown.n++
        return { result: { questions: e.questions, answers: { [q]: 'Approve' } } as never }
      })
      const got = await $.tool.call(ask(q))
      expect(shown.n).toBe(1)
      expect(got.result).toEqual({ questions: ask(q).questions, answers: { [q]: 'Approve' } })
      expect(got.context).toBeUndefined()
      expect(cliRuns()).toEqual([])
      expect(toasts).toEqual([])
    })
  }

  test('ready for something else does not approve this plan', async ($, on) => {
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
    const { approveRuns, toasts } = world(on, [{ slug: 'done', stage: 'plan', approvals: { prd: DONE }, worktree: '/wt/done' }])
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
    world(on, [{ slug: 'done', stage: 'ship', approvals: { prd: DONE }, worktree: '/wt/done' }])
    const shown = counted(on, () => ({}))
    const a = 'PRD? [cairn:approve prd done]'
    const b = 'PRD again? [cairn:approve prd done]'
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
    world(on, [
      { slug: 'half', stage: 'plan', approvals: { prd: DONE }, worktree: '/wt/half' },
      { slug: 'unhalf', stage: 'prd', worktree: '/wt/unhalf' },
    ])
    const a = 'PRD? [cairn:approve prd half]'
    const b = 'PRD? [cairn:approve prd unhalf]'
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

  test('two stops of two plans in one dialog: only the session\'s own plan is approved', async ($, on) => {
    const { approveRuns, toasts } = world(on, [
      { slug: 'one', stage: 'prd', worktree: '/wt/one' },
      { slug: 'two', stage: 'prd', worktree: '/wt/two' },
    ])
    const a = 'Approve the PRD? [cairn:approve prd one]'
    const b = 'Approve the PRD? [cairn:approve prd two]'
    counted(on, () => ({ [a]: 'Approve (Recommended)', [b]: 'Approve (Recommended)' }))
    const got = await $.tool.call(ask(a, b))
    // The session had no plan, so the first tag made `one` its own; `two` belongs to another session.
    expect(approveRuns().map(r => [r.init?.cwd, ...r.argv.slice(1)])).toEqual([['/wt/one', 'approve', 'prd']])
    expect(got.context?.join('\n')).toMatch(/one: prd approved[\s\S]*this session works on one, so the prd approval on two was not done/)
    expect(toasts).toHaveLength(2)
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
  test('each use writes its own hash-named file with mode 0600 just before it, and removes it after', async ($, on) => {
    const { hashes, runs, approveRuns, live } = world(on, [{ slug: 'mode', stage: 'prd', worktree: '/wt/mode' }])
    const q = 'Approve? [cairn:approve prd mode]'
    dialog(on, { [q]: 'Approve' })
    await $.tool.call(ask(q))
    const order = runs.map(r => (r.argv[1] === 'approve' ? 'approve' : r.argv.join(' ')))
    const file = `${TOKEN_PREFIX}${hashes[0]}`
    const at = order.indexOf('approve')
    expect(order.slice(at - 1, at + 2)).toEqual([`chmod 600 ${file}`, 'approve', `rm -f ${file}`])
    expect(hashes).toEqual([await sha256(approveRuns()[0]?.init?.env?.CAIRN_APPROVER ?? '')])
    // The common dir is read where the CLI runs, so the file lands where the CLI looks.
    expect(runs.find(r => r.argv[0] === 'git')?.init?.cwd).toBe('/wt/mode')
    expect(live.size).toBe(0)
  })

  test('another session approving in between leaves this session\'s next approval working', async ($, on) => {
    // The incident: worktrees share one git common dir, so every session's mod writes there. A secret kept
    // ready after a use went stale as soon as another session's mod wrote its own.
    const plans: Plan[] = [{ slug: 'mine', stage: 'prd', worktree: '/wt/mine' }]
    const { approveRuns, live } = world(on, plans)
    const first = 'Approve? [cairn:approve prd mine]'
    const second = 'Approve the edited PRD? [cairn:approve prd mine]'
    dialog(on, { [first]: 'Approve', [second]: 'Approve' })
    await $.tool.call(ask(first))
    expect(live.size).toBe(0)
    // The PRD is edited after its approval: it waits for the person again.
    plans[0]!.approvals = { prd: { via: 'human' } }
    plans[0]!.ready = { kind: 'prd' }
    live.add(await sha256('another session\'s secret'))
    const got = await $.tool.call(ask(second))
    expect(got.context?.join()).toMatch(/prd approved/)
    expect(approveRuns()).toHaveLength(2)
    expect(live).toEqual(new Set([await sha256('another session\'s secret')]))
  })

  test('a refusal for a stop that another path approved meanwhile says nothing', async ($, on) => {
    // A menu answer and a pane press on one stop both pass the ready check; the second CLI run is refused.
    const { toasts } = world(on, [{ slug: 'race', stage: 'prd', worktree: '/wt/race' }], { refuse: 'not waiting for prd approval', elsewhere: true })
    const q = 'Approve? [cairn:approve prd race]'
    dialog(on, { [q]: 'Approve' })
    const got = await $.tool.call(ask(q))
    expect(got.context ?? []).toEqual([])
    expect(toasts).toEqual([])
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

  test('back-to-back approvals each use their own secret, and both land', async ($, on) => {
    const plans: Plan[] = [{ slug: 'one', stage: 'prd', worktree: '/wt/one' }]
    const { approveRuns, hashes } = world(on, plans)
    const one = 'Approve? [cairn:approve prd one]'
    const two = 'Approve the edited PRD? [cairn:approve prd one]'
    dialog(on, { [one]: 'Approve', [two]: 'Approve' })
    const first = await $.tool.call(ask(one))
    plans[0]!.approvals = { prd: { via: 'human' } }
    plans[0]!.ready = { kind: 'prd' }
    const second = await $.tool.call(ask(two))
    const [a, b] = approveRuns().map(r => r.init?.env?.CAIRN_APPROVER ?? '')
    expect(a).not.toBe(b)
    expect(hashes).toContain(await sha256(a ?? ''))
    expect(hashes).toContain(await sha256(b ?? ''))
    expect(first.context?.join()).toMatch(/prd approved/)
    expect(second.context?.join()).toMatch(/prd approved/)
  })

  test('two plans\' questions answered at once in a session with no plan: exactly one plan becomes its own', async ($, on) => {
    const { approveRuns } = world(on, [
      { slug: 'c1', stage: 'prd', worktree: '/wt/c1' },
      { slug: 'c2', stage: 'prd', worktree: '/wt/c2' },
    ])
    const one = 'Approve? [cairn:approve prd c1]'
    const two = 'Approve? [cairn:approve prd c2]'
    dialog(on, { [one]: 'Approve', [two]: 'Approve' })
    const said = (await Promise.all([$.tool.call(ask(one)), $.tool.call(ask(two))])).map(r => r.context?.join() ?? '')
    expect(approveRuns()).toHaveLength(1)
    expect(said.filter(t => /c[12]: prd approved/.test(t))).toHaveLength(1)
    expect(said.filter(t => /this session works on c[12]/.test(t))).toHaveLength(1)
  })
})

describe('one plan per session', () => {
  const MAIN = '/repo'
  const wtA = '/repo/.claude/worktrees/feature-a'
  const wtB = '/repo/.claude/worktrees/feature-b'

  function bash(on: On) {
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  }

  test('a cairn command run in a plan\'s worktree makes it the session\'s plan; another plan\'s approval is refused', async ($, on) => {
    const { approveRuns } = world(on, [
      { slug: 'a', stage: 'prd', worktree: wtA },
      { slug: 'b', stage: 'prd', worktree: wtB },
    ])
    bash(on)
    const qa = 'Approve? [cairn:approve prd a]'
    const qb = 'Approve? [cairn:approve prd b]'
    dialog(on, { [qa]: 'Approve', [qb]: 'Approve' })
    await $.tool.call({ tool: 'Bash', command: `cd ${wtB} && cairn status` })
    expect((await $.tool.call(ask(qa))).context?.join()).toMatch(/this session works on b, so the prd approval on a was not done; do it from a's own session/)
    expect((await $.tool.call(ask(qb))).context?.join()).toMatch(/b: prd approved/)
    expect(approveRuns().map(r => r.init?.cwd)).toEqual([wtB])
  })

  test('a command that is not cairn, or that names two plans\' worktrees, gives the session no plan', async ($, on) => {
    const { approveRuns } = world(on, [
      { slug: 'a', stage: 'prd', worktree: wtA },
      { slug: 'b', stage: 'prd', worktree: wtB },
    ])
    bash(on)
    const qb = 'Approve? [cairn:approve prd b]'
    dialog(on, { [qb]: 'Approve' })
    await $.tool.call({ tool: 'Bash', command: `cat ${wtA}/docs/cairn/plans/a/prd.md` })
    await $.tool.call({ tool: 'Bash', command: `cd ${wtA} && cairn status && cd ${wtB} && cairn status` })
    await $.tool.call({ tool: 'Bash', command: `cd ${wtA}-old && cairn status` })
    // Still no plan of its own: the first tagged question names it.
    expect((await $.tool.call(ask(qb))).context?.join()).toMatch(/b: prd approved/)
    expect(approveRuns().map(r => r.init?.cwd)).toEqual([wtB])
  })

  test('a plan kept in the main checkout does not hide the worktree a command names', async ($, on) => {
    world(on, [
      { slug: 'root', stage: 'execute', worktree: MAIN },
      { slug: 'b', stage: 'prd', worktree: wtB },
    ], { cwd: '/elsewhere' })
    bash(on)
    const q = 'Approve? [cairn:approve prd b]'
    dialog(on, { [q]: 'Approve' })
    await $.tool.call({ tool: 'Bash', command: `cd ${wtB} && cairn status` })
    expect((await $.tool.call(ask(q))).context?.join()).toMatch(/b: prd approved/)
  })

  test('once its plan is closed, the session can take up another', async ($, on) => {
    const plans: Plan[] = [
      { slug: 'a', stage: 'prd', worktree: wtA },
      { slug: 'b', stage: 'prd', worktree: wtB },
    ]
    world(on, plans)
    const qa = 'Approve? [cairn:approve prd a]'
    const qb = 'Approve? [cairn:approve prd b]'
    dialog(on, { [qa]: 'Approve', [qb]: 'Approve' })
    expect((await $.tool.call(ask(qa))).context?.join()).toMatch(/a: prd approved/)
    expect((await $.tool.call(ask(qb))).context?.join()).toMatch(/works on a/)
    plans[0]!.stage = 'closed'
    expect((await $.tool.call(ask(qb))).context?.join()).toMatch(/b: prd approved/)
  })

  test('a session that moves into another plan\'s worktree keeps its own plan', async ($, on) => {
    const { approveRuns, where } = world(on, [
      { slug: 'a', stage: 'prd', worktree: wtA },
      { slug: 'b', stage: 'prd', worktree: wtB },
    ], { cwd: `${wtA}/src` })
    const qa = 'Approve? [cairn:approve prd a]'
    const qb = 'Approve? [cairn:approve prd b]'
    dialog(on, { [qa]: 'Approve', [qb]: 'Approve' })
    expect((await $.tool.call(ask(qa))).context?.join()).toMatch(/a: prd approved/)
    where.cwd = wtB
    expect((await $.tool.call(ask(qb))).context?.join()).toMatch(/this session works on a, so the prd approval on b was not done/)
    expect(approveRuns().map(r => r.init?.cwd)).toEqual([wtA])
  })

  test('a level change for another session\'s plan is refused', async ($, on) => {
    const { levelRuns } = world(on, [
      { slug: 'a', stage: 'prd', worktree: wtA },
      { slug: 'b', stage: 'prd', worktree: wtB },
    ], { cwd: `${wtA}/src` })
    const q = 'Which level? [cairn:level b]'
    dialog(on, { [q]: 'MVP' })
    expect((await $.tool.call(ask(q))).context?.join()).toMatch(/this session works on a, so the level change on b was not done/)
    expect(levelRuns()).toEqual([])
  })
})

describe('menu level change', () => {
  const askLevel = (q: string, extra: Record<string, unknown> = {}) => ({
    tool: 'AskUserQuestion' as const,
    questions: [{
      question: q,
      header: 'Level',
      multiSelect: false,
      options: ['MVP', 'Standard', 'Polished'].map(label => ({ label, description: label })),
      ...extra,
    }],
  })

  test('parseTags reads a level tag with its slug and question', () => {
    expect(parseTags([{ question: 'How deep? [cairn:level shop-2]' }])).toEqual([
      { slug: 'shop-2', question: 'How deep? [cairn:level shop-2]', level: true },
    ])
  })

  test('a picked label runs cairn level with the secret in the plan worktree', async ($, on) => {
    const { hashes, levelRuns, toasts } = world(on, [{ slug: 'lv', stage: 'plan', worktree: '/wt/lv' }])
    const q = 'How deep? [cairn:level lv]'
    dialog(on, { [q]: 'Polished' })
    const got = await $.tool.call(askLevel(q))
    const [run] = levelRuns()
    expect(levelRuns()).toHaveLength(1)
    expect(run?.argv.slice(1)).toEqual(['level', 'polished'])
    expect(run?.init?.cwd).toBe('/wt/lv')
    expect(hashes[0]).toBe(await sha256(run?.init?.env?.CAIRN_APPROVER ?? ''))
    expect(got.context?.join('\n')).toMatch(/Level raised to polished/)
    expect(toasts.join('\n')).toMatch(/Level raised to polished/)
  })

  const maps: [string, string][] = [['MVP', 'mvp'], ['Standard', 'standard'], ['Polished (Recommended)', 'polished']]
  for (const [label, literal] of maps) {
    test(`"${label}" maps to ${literal}`, async ($, on) => {
      const { levelRuns } = world(on, [{ slug: 'lv', stage: 'plan', worktree: '/wt/lv' }])
      const q = 'How deep? [cairn:level lv]'
      dialog(on, { [q]: label })
      await $.tool.call(askLevel(q))
      expect(levelRuns().map(r => r.argv.slice(1))).toEqual([['level', literal]])
    })
  }

  for (const label of ['Keep it as is', 'polished', 'Polished-ish', 'Approve', '--human']) {
    test(`the label "${label}" changes nothing`, async ($, on) => {
      const { levelRuns } = world(on, [{ slug: 'lv', stage: 'plan', worktree: '/wt/lv' }])
      const q = 'How deep? [cairn:level lv]'
      dialog(on, { [q]: label })
      await $.tool.call(askLevel(q))
      expect(levelRuns()).toEqual([])
    })
  }

  test('an answer the model put in its own call is ignored and said so', async ($, on) => {
    const { levelRuns } = world(on, [{ slug: 'lv', stage: 'plan', worktree: '/wt/lv' }])
    const q = 'How deep? [cairn:level lv]'
    dialog(on, { [q]: 'Polished' })
    const got = await $.tool.call({ ...askLevel(q), answers: { [q]: 'Polished' } })
    expect(levelRuns()).toEqual([])
    expect(got.context?.join('\n')).toMatch(/came from the model's call/)
  })

  test('a dialog that answered itself while away (afkTimeoutMs) changes nothing', async ($, on) => {
    const { levelRuns } = world(on, [{ slug: 'lv', stage: 'plan', worktree: '/wt/lv' }])
    const q = 'How deep? [cairn:level lv]'
    dialog(on, { [q]: 'Polished' }, { afkTimeoutMs: 60_000 })
    const got = await $.tool.call(askLevel(q))
    expect(levelRuns()).toEqual([])
    expect(got.context?.join('\n')).toMatch(/while you were away/)
  })

  test('a multi-select level question changes nothing', async ($, on) => {
    const { levelRuns } = world(on, [{ slug: 'lv', stage: 'plan', worktree: '/wt/lv' }])
    const q = 'How deep? [cairn:level lv]'
    dialog(on, { [q]: 'Polished' })
    await $.tool.call(askLevel(q, { multiSelect: true }))
    expect(levelRuns()).toEqual([])
  })

  test('a subagent\'s level menu is left alone', async ($, on) => {
    const { levelRuns } = world(on, [{ slug: 'lv', stage: 'plan', worktree: '/wt/lv' }])
    const q = 'How deep? [cairn:level lv]'
    dialog(on, { [q]: 'Polished' })
    await $.tool.call({ ...askLevel(q), agentId: 'a1' } as never)
    expect(levelRuns()).toEqual([])
  })

  test('a dismissed dialog changes nothing', async ($, on) => {
    const { levelRuns } = world(on, [{ slug: 'lv', stage: 'plan', worktree: '/wt/lv' }])
    on('tool.call', { tool: 'AskUserQuestion' }, () => ({ deny: 'The user dismissed the question.' }))
    const got = await $.tool.call(askLevel('How deep? [cairn:level lv]'))
    expect(levelRuns()).toEqual([])
    expect(got.deny).toBe('The user dismissed the question.')
  })

  test('a plan that is not checked out is refused with a reason', async ($, on) => {
    const { levelRuns } = world(on, [{ slug: 'lv', stage: 'plan' }])
    const q = 'How deep? [cairn:level lv]'
    dialog(on, { [q]: 'MVP' })
    const got = await $.tool.call(askLevel(q))
    expect(levelRuns()).toEqual([])
    expect(got.context?.join('\n')).toMatch(/not checked out/)
  })

  test('a CLI refusal is carried in context and a toast', async ($, on) => {
    const { toasts } = world(on, [{ slug: 'lv', stage: 'plan', worktree: '/wt/lv' }], { refuse: 'lowering the level is only allowed before any task starts' })
    const q = 'How deep? [cairn:level lv]'
    dialog(on, { [q]: 'MVP' })
    const got = await $.tool.call(askLevel(q))
    expect(got.context?.join('\n')).toMatch(/refused: .*lowering the level/)
    expect(toasts.join('\n')).toMatch(/refused: .*lowering the level/)
  })

  test('an approval, then a level change, both succeed in order with their own secrets', async ($, on) => {
    const { runs, approveRuns, levelRuns } = world(on, [{ slug: 'lv', stage: 'prd', worktree: '/wt/lv' }])
    const a = 'Approve the PRD? [cairn:approve prd lv]'
    const l = 'How deep? [cairn:level lv]'
    dialog(on, { [a]: 'Approve', [l]: 'Polished' })
    const got = await $.tool.call({
      tool: 'AskUserQuestion' as const,
      questions: [...ask(a).questions, ...askLevel(l).questions],
    })
    expect(approveRuns()).toHaveLength(1)
    expect(levelRuns()).toHaveLength(1)
    const order = runs.map(r => r.argv[1]).filter(v => v === 'approve' || v === 'level')
    expect(order).toEqual(['approve', 'level'])
    expect(approveRuns()[0]?.init?.env?.CAIRN_APPROVER).not.toBe(levelRuns()[0]?.init?.env?.CAIRN_APPROVER)
    expect(got.context?.join('\n')).toMatch(/prd approved/)
    expect(got.context?.join('\n')).toMatch(/Level raised/)
  })
})
