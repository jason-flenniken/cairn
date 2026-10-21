// cairn's mod: this file only wires the feature modules under mod/, one concern each.
import type { Register } from 'claude-code'
import { install as installActivity, onSessionStart as activityStart } from './mod/activity.ts'
import { install as installApprove } from './mod/approve.ts'
import { install as installGuards } from './mod/guards.ts'
import { onSessionStart as heartbeatStart } from './mod/heartbeat.ts'
import { install as installPane, onSessionStart as paneStart } from './mod/pane.tsx'
import { install as installPause, onSessionStart as pauseStart } from './mod/pause.ts'

export const register: Register = on => {
  installGuards(on)
  // The engine allows one unmatched session.start hook per module, so each module's start
  // work runs from this one, in turn. A failing module never stops the others or the session.
  on('session.start', async ($, e, next) => {
    try {
      await heartbeatStart($, e)
    } catch {
      // The heartbeat is best effort (NFR-07).
    }
    try {
      await pauseStart($, e)
    } catch {
      // Without the commands the pane buttons still work (NFR-07).
    }
    try {
      await activityStart($, e)
    } catch {
      // Without the cards the pane still shows the plan (NFR-07).
    }
    try {
      await paneStart($, e)
    } catch {
      // Without the pane the commands and the session go on (NFR-07).
    }
    return next(e)
  })
  installApprove(on)
  installPause(on)
  installPane(on)
  installActivity(on)
}
