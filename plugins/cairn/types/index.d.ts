// cairn's mod types contract, named in plugin.json "types". It adds no noun to `$`.

/** What `cairn($, args)` in hooks/mod/cli.ts resolves with. */
export type CairnRun = {
  exitCode: number
  stdout: string
  stderr: string
  /** stdout parsed as JSON, when it parses. */
  json?: any
}

/** A plan's state.json as the pane reads it: the fields it draws, each possibly absent in an old plan. */
export type CairnPlanState = {
  slug: string
  title?: string
  stage?: string
  updated?: string
  paused?: { at?: string } | null
  approvals?: Record<string, unknown>
  phases?: unknown
  drift?: unknown
  log?: unknown
}

/** One row of `cairn status --all --json`. */
export type CairnPlanRow = {
  state: CairnPlanState
  worktree?: string
  next?: { text?: string }
  /** Suggestions nobody has closed; absent until the CLI reports them. */
  openSuggestions?: number
  /** The plan's config.maxParallel, when the CLI reports it. */
  maxParallel?: number
}

/** The pane's last good read: every plan, and the slug of the one the session works on (isFallback: chosen from the repo root, not by location). */
export type CairnView = { plans: CairnPlanRow[]; here?: string; isFallback?: boolean }

/** One subagent's card in the pane's NOW section (hooks/mod/activity.ts). */
export type AgentCard = {
  agentId: string
  title: string
  type: string
  model: string
  startedAt: number
  steps: number
  action?: string
  actionSince?: number
  status: 'working' | 'done' | 'failed'
  endedAt?: number
  durationMs?: number
  tokens?: number
}

declare module 'claude-code' {
  interface PluginState {
    cairn: {
      view: CairnView | null
      isTurnRunning: boolean
      agents: AgentCard[]
      /** The main session's current action; null while no turn runs. */
      mainActivity: { action: string; since: number } | null
      /** The last few finished-agent lines. */
      feed: { at: number; text: string }[]
      /** Ticked while anything is active, so the pane redraws its timers. */
      now: number
    }
  }
}
