import { parseIntent } from './ollama.js'

// Explicit authenticated !sara ask requests only. No ambient chat or autonomous loop.
export function goalRequest(text) {
  if (typeof text !== 'string' || text.length > 160 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u.test(text)) return null
  const match = /^!sara ask (.{1,150})$/i.exec(text.trim())
  return match?.[1].trim() || null
}
export function goalPrompt(request, state, history) {
  // Registry names and counts only; no player names, raw chat, credentials or host data.
  const rounded = p => p && Object.fromEntries(['x','y','z'].map(k=>[k,Math.round(p[k]*10)/10]))
  const observed = {
    position: rounded(state.position), health: state.health, commander: rounded(state.commander),
    inventory: state.inventory.slice(0,8), inventoryTruncated: state.inventory.length > 8,
    nearbyTruncated: state.nearbyTruncated === true || state.nearby.length > 4,
    nearby: state.nearby.slice(0,4).map(e => ({ kind:e.kind, position:rounded(e.position), item:e.item }))
  }
  let data = JSON.stringify({ request, history, observed })
  while (data.length > 1000 && (observed.nearby.length || observed.inventory.length)) {
    if (observed.nearby.length) { observed.nearby.pop(); observed.nearbyTruncated = true }
    else { observed.inventory.pop(); observed.inventoryTruncated = true }
    data = JSON.stringify({ request, history, observed })
  }
  if (data.length > 1000) throw Error('OBSERVATION_TOO_LARGE')
  return data
}
const commands = Object.freeze({ follow:'!sara follow', come:'!sara come', look:'!sara look', collect:'!sara collect', stop:'!sara stop' })
export async function runGoal({request, provider, observe, execute, reply, report, signal, current}) {
  const history = []
  const allowed = () => !signal.aborted && current()
  for (let step=1; step<=3; step++) {
    if (!allowed()) return
    const state = observe()
    if (!state) { report('goal_end',{reason:'OBSERVATION_UNAVAILABLE'}); return }
    let intent
    try {
      report('inference_start',{step})
      const proposal = await provider.propose(goalPrompt(request,state,history),signal)
      if (!allowed()) return
      intent = parseIntent(JSON.stringify(proposal))
    } catch {
      if (allowed()) report('goal_end',{reason:'INFERENCE_REJECTED'})
      return
    }
    if (!allowed()) return
    report('inference_intent',{step,action:intent.action})
    if (intent.action === 'chat') {
      reply(intent.text)
      report('goal_end',{reason:'CHAT',step})
      return
    }
    if (history.some(entry => entry.action === intent.action && entry.result === 'COMPLETED')) {
      report('goal_end',{reason:'REPEATED_ACTION',step}); reply('That action is already complete.'); return
    }
    const result = await execute(commands[intent.action], intent.action)
    if (!allowed()) return
    history.push({action:intent.action,result:result.state})
    report('goal_action',{step,action:intent.action,state:result.state,reason:result.reason})
    // Follow is continuous until STOP, replacement, timeout or safety cancellation.
    // Never infer another action behind an active follow or after failure.
    if (result.state !== 'COMPLETED' || intent.action === 'stop' || intent.action === 'follow') {
      report('goal_end',{reason:result.state,step}); return
    }
  }
  if (allowed()) report('goal_end',{reason:'ACTION_LIMIT'})
}
