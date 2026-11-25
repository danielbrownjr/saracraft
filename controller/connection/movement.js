import { normalizeTrustedChat } from '../src/bridge.js'
import { parseCommand } from '../src/commands.js'
import { SaraController } from '../src/controller.js'
import { assessNavigation, NavigationSafetyMonitor } from '../navigation/safety.js'
import pathfinder from 'mineflayer-pathfinder'
import { createTelemetry, isWater } from './telemetry.js'
import { inventoryCounts, droppedItem, nearestDrop, observeGameplay, statusText, facing } from './gameplay.js'
import { goalRequest, runGoal } from '../inference/goal.js'
import { isCommandCandidate, observeChatWire } from './chat-admission.js'

const { Movements, goals, pathfinder: plugin } = pathfinder
const movementCommands = new Set(['follow', 'stop', 'comeHere', 'status', 'look', 'collect'])
const normalizeUuid = uuid => typeof uuid === 'string' ? uuid.replaceAll('-', '').toLowerCase() : ''
export { isWater }

export function commandEnvelope(packet, commanderUuid) {
  if (packet?.authenticated !== true || normalizeUuid(packet.sender) !== normalizeUuid(commanderUuid) ||
      !(movementCommands.has(parseCommand(packet.plainMessage)?.kind) || goalRequest(packet.plainMessage))) return null
  return normalizeTrustedChat({ senderUuid: commanderUuid, text: packet.plainMessage,
    isPlayerChat: true, serverAuthenticated: true, senderIdentityResolved: true })
}

export function commandReply(kind, result) {
  // Promise settlement and cleared controls do not establish in-world cessation.
  if (kind === 'stop') return result.haltState === 'acknowledged' ? 'Halt acknowledged; movement cessation unverified.' : null
  if (!result.accepted) return null
  if (kind === 'follow') return 'Following!'
  if (kind === 'comeHere') return 'Coming!'
  return null
}

// Attach before spawn to observe raw metadata. No goal is admitted until complete
// telemetry is available. options supplies clocks/deadlines only for offline fixtures.
function installMovement(bot, commanderUuid, report, options = {}) {
  const output = report
  report = (...args) => { try { output(...args) } catch {} }
  const policy = options.policy ?? 'strict'
  if (!['strict', 'supervised-dry'].includes(policy)) throw new RangeError('invalid navigation policy')
  const now = options.now ?? Date.now
  const cadenceMs = options.cadenceMs ?? 100
  if (!Number.isFinite(cadenceMs) || cadenceMs <= 0 || cadenceMs > 100) throw new RangeError('invalid movement cadence')
  const telemetry = options.telemetry ?? createTelemetry(bot, { now, policy })
  bot.loadPlugin(plugin)
  const movements = options.movements ?? new Movements(bot)
  Object.assign(movements, { canDig: false, canOpenDoors: false, allow1by1towers: false,
    allowParkour: false, allowSprinting: false, allowFreeMotion: false, maxDropDown: 1,
    scafoldingBlocks: [] })
  movements.blocksToAvoid.add(bot.registry.blocksByName.water.id)
  movements.exclusionAreasStep.push(block => isWater(block) ? 101 : 0)
  bot.pathfinder.setMovements(movements)
  Object.assign(bot.pathfinder, { searchRadius: 32, thinkTimeout: options.searchTimeoutMs ?? 100, tickTimeout: options.searchTickTimeoutMs ?? 10,
    enablePathShortcut: false })

  const originalGoal = bot.pathfinder.setGoal.bind(bot.pathfinder)
  const originalControl = bot.setControlState.bind(bot)
  const originalClear = bot.clearControlStates.bind(bot)
  let active = null
  let disconnected = false
  let disposed = false
  let haltingDepth = 0
  function rawHalt() {
    haltingDepth++
    let error
    try { originalGoal(null) } catch (err) { error = err }
    try { originalClear() } catch (err) { error ??= err }
    haltingDepth--
    if (error) throw error
  }
  function taskHalt(task) {
    if (!task.haltState) {
      task.haltState = 'pending'
      try { rawHalt(); task.haltState = 'acknowledged' } catch { task.haltState = 'failed' }
    }
    if (task.haltState === 'failed') throw new Error('HALT_FAILED')
  }
  function waitingForRoute(task) {
    return task.partial === true || task.pickedUp || ((task.follow || task.collect) && task.goalInstalled && !task.path?.[0])
  }
  function clearWaitingControls() {
    haltingDepth++
    try { originalClear() } finally { haltingDepth-- }
  }
  function read(task) {
    if (task.blocked === 'STATE_UNAVAILABLE') throw new Error('STATE_UNAVAILABLE')
    // A stationary sample monitors hazards while an admitted dynamic goal waits
    // or replans. It is never a substitute for a route step at actuation.
    return task.blocked ? (task.unsafeSnapshot ?? null) : telemetry.readState(
      waitingForRoute(task) ? bot.entity?.position : (task.path?.[0] ?? task.proposedStep))
  }
  function reportTrip(task, verdict) {
    if (task.tripReported) return
    task.tripReported = true
    report('movement_safety', { ...verdict, movementStopped: false,
      recovery: verdict.reason === 'WATER_EXIT_REQUIRED' ? 'unavailable_no_verified_escape' : undefined })
  }
  function rejectMovement(task, snapshot, reason) {
    if (task.blocked) return
    task.blocked = reason
    task.unsafeSnapshot = snapshot
    // Block and clear actuation synchronously. The reviewed monitor independently
    // latches the sampled reason and bounds its halt acknowledgement.
    try { taskHalt(task) } catch {}
    const checked = task.monitor.check()
    task.cancel?.(reason)
    task.finish(false, reason)
    void checked.then(verdict => reportTrip(task, verdict))
  }
  function guard(task) {
    if (!task || task !== active || disposed || disconnected || task.signal.aborted || task.blocked || task.monitor.tripped) return false
    const position = bot.entity?.position
    const currentTarget = commanderEntity()
    const fromStart = position?.distanceTo(task.start)
    const fromTarget = position && currentTarget?.position ? position.distanceTo(currentTarget.position) : NaN
    if (currentTarget !== task.target || !Number.isFinite(fromStart) || !Number.isFinite(fromTarget) ||
        fromStart > task.radius || fromTarget > task.radius || (task.collect && !task.pickedUp && bot.entities?.[task.item.id] !== task.item)) {
      task.blocked = 'MOVEMENT_BOUNDARY'; task.cancel?.(task.blocked); task.finish(false, task.blocked); return false
    }
    let snapshot
    try { snapshot = read(task) } catch { snapshot = null }
    let verdict
    try { verdict = assessNavigation(snapshot, { now: now(), maxAgeMs: 1000, policy }) }
    catch { verdict = { safe: false, reason: 'STATE_UNAVAILABLE' }; snapshot = null }
    if (!verdict.safe) { rejectMovement(task, snapshot, verdict.reason); return false }
    // Final synchronous R2 boundary: no promise, await or event emission follows
    // this check before invoking Mineflayer's original synchronous API.
    return task === active && !task.signal.aborted && !task.blocked && task.monitor.tripped === null
  }
  const guardedControl = (control, value) => {
    if (value === false && haltingDepth > 0) return originalControl(control, false)
    const task = active
    if (task && (task.pickedUp || task.partial || ((task.follow || task.collect) && !task.path?.[0]))) {
      if (!value) return originalControl(control, false)
      if (waitingForRoute(task)) clearWaitingControls()
      return
    }
    if (guard(task)) return originalControl(control, value)
    // Deassertions outside a task are halt operations, not ordinary navigation.
    if (!value && !active) return originalControl(control, value)
  }
  const guardedGoal = (goal, dynamic = false) => {
    if (goal === null) return originalGoal(null)
    if (guard(active)) return originalGoal(goal, dynamic)
  }
  bot.setControlState = guardedControl
  bot.pathfinder.setGoal = guardedGoal

  function halt(cancelInference = true) {
    if (cancelInference) cancelGoal()
    const task = active
    if (task) {
      task.blocked ??= 'HALT'
      task.cancel?.(task.blocked)
      try { taskHalt(task) } finally { task.finish(false, task.blocked) }
    } else rawHalt()
  }
  async function check(task) {
    if (task !== active || task.checking || task.finishing) return
    task.checking = true
    try {
      const verdict = await task.monitor.check({ signal: task.signal })
      if (!verdict.safe) {
        task.blocked ??= verdict.reason
        task.cancel?.(task.blocked)
        task.finish(false, task.blocked)
        reportTrip(task, verdict)
      }
    } finally { task.checking = false }
  }
  const commanderEntity = () => Object.values(bot.players ?? {}).find(p => normalizeUuid(p.uuid) === normalizeUuid(commanderUuid))?.entity
  function move(uuid, { signal, radiusMax = 32, cancel }, follow, collect = false) {
    const target = commanderEntity()
    const item = collect ? nearestDrop(bot) : null
    const drop = collect ? droppedItem(item) : null
    const before = collect ? inventoryCounts(bot) : null
    if (collect && (!item || !drop || !before)) return Promise.resolve({ verified: false })
    const position = bot.entity?.position
    if (disconnected || disposed || active || signal.aborted || !position || !target?.position ||
        position.distanceTo(target.position) > Math.min(radiusMax, 32)) return Promise.resolve({ verified: false })
    const start = position.clone()
    const destination = (collect ? item : target).position.clone()
    const goal = follow ? new goals.GoalFollow(target, 2) : new goals.GoalNear(destination.x, destination.y, destination.z, collect ? 0 : 2)
    if (follow) {
      // Pinned GoalFollow only refreshes its cached center after >2 blocks.
      // Refresh on each changed block so a commander stepping out of range
      // can wake an exhausted route even after a small move.
      goal.hasChanged = () => {
        const p = target.position.floored()
        if (p.x === goal.x && p.y === goal.y && p.z === goal.z) return false
        Object.assign(goal, { x: p.x, y: p.y, z: p.z })
        return true
      }
    }
    return new Promise(resolve => {
      const task = { signal, cancel, start, target, destination, follow, radius: Math.min(radiusMax, 32), path: null, proposedStep: null,
        blocked: null, finishing: false, checking: false, haltState: null, goalInstalled: false, collect, item, drop, before, pickedUp: false, partial: false }
      active = task
      const finish = (verified, reason = '') => {
        if (task.finishing) return
        task.finishing = true
        signal.removeEventListener('abort', onAbort)
        clearInterval(task.timer)
        if (collect) bot.removeListener('playerCollect', onCollect)
        if (active === task) {
          try { taskHalt(task) } catch {}
          active = null
        }
        report('movement_end', { verified, reason, haltState: task.haltState, movementStopped: false })
        resolve({ verified, reason, haltState: task.haltState, movementStopped: false })
      }
      const onCollect = (collector, collected) => {
        if (active !== task || signal.aborted || collector !== bot.entity || collected !== item) return
        task.pickedUp = true
        task.path = null; task.proposedStep = null
        try { rawHalt() } catch { rejectMovement(task, null, 'STATE_UNAVAILABLE') }
      }
      if (collect) bot.on('playerCollect', onCollect)
      task.finish = finish
      const onAbort = () => finish(false, signal.reason?.message ?? 'CANCELLED')
      task.monitor = new NavigationSafetyMonitor({ readState: () => read(task),
        halt: () => taskHalt(task), now, policy,
        readTimeoutMs: options.readTimeoutMs ?? 400, haltTimeoutMs: options.haltTimeoutMs ?? 1000 })
      signal.addEventListener('abort', onAbort, { once: true })
      task.timer = setInterval(() => { void check(task) }, cadenceMs)
      task.timer.unref?.()
      void (async () => {
        try {
          // Current immersion takes priority over an unavailable ordinary route.
          // This stationary volume is used solely to reject submerged navigation;
          // it never authorizes a goal or stands in for a proposed route step.
          const current = telemetry.readState(start)
          if (current?.inWater === true) {
            const verdict = assessNavigation(current, { now: now(), maxAgeMs: 1000, policy })
            if (!verdict.safe) { rejectMovement(task, current, verdict.reason); return }
          }
          // Public generator avoids getPathTo's mutation of pathfinder's active A*.
          const search = bot.pathfinder.getPathFromTo(movements, start, goal,
            { timeout: options.searchTimeoutMs ?? 100, tickTimeout: options.searchTickTimeoutMs ?? 10, searchRadius: 32 })
          let next = search.next().value?.result
          const deadline = Date.now() + (options.searchTimeoutMs ?? 100)
          while (next?.status === 'partial' && Date.now() < deadline && !signal.aborted) {
            if (!Array.isArray(next.path) || next.path.some(p => p.toBreak?.length || p.toPlace?.length)) break
            task.partial = true
            await new Promise(resolve => setImmediate(resolve))
            if (signal.aborted || task !== active) return
            next = search.next().value?.result
          }
          if (next?.status !== 'success' || !Array.isArray(next.path) ||
              next.path.some(p => p.toBreak?.length || p.toPlace?.length)) {
            rejectMovement(task, null, 'UNKNOWN_STATE'); return
          }
          if (task.pickedUp) return
          task.partial = false
          task.proposedStep = next.path[0] ?? (goal.isEnd(position.floored()) ? position.clone() : null)
          const verdict = await task.monitor.check({ signal })
          if (!verdict.safe) {
            task.blocked ??= verdict.reason; cancel?.(task.blocked); finish(false, task.blocked); reportTrip(task, verdict); return
          }
          if (!guard(task)) return
          // guardedGoal repeats R2 immediately before the actual goal API.
          bot.pathfinder.setGoal(goal, follow)
          task.goalInstalled = true
          if (follow || collect) task.proposedStep = null
        } catch {
          if (!task.finishing) rejectMovement(task, null, 'STATE_UNAVAILABLE')
        }
      })()
    })
  }
  const controller = new SaraController({ commanderUuid, ...(options.controllerOptions ?? {}), adapter: {
    follow: (uuid, opts) => move(uuid, opts, true), comeHere: (uuid, opts) => move(uuid, opts, false),
    status: async (uuid, { signal }) => {
      if (signal.aborted || disconnected || disposed) return { verified: false }
      const state = observeGameplay(bot, commanderEntity())
      if (!state) return { verified: false }
      report('gameplay_observation', state)
      bot.chat(statusText(state))
      return { verified: true }
    },
    look: async (uuid, { signal }) => {
      const target = commanderEntity()
      if (signal.aborted || disconnected || disposed || !target?.position ||
          bot.entity.position.distanceTo(target.position) > 8) return { verified: false }
      await bot.lookAt(target.position.offset(0, (target.height ?? 1.6) * 0.9, 0), true)
      return { verified: !signal.aborted && !disconnected && !disposed && commanderEntity() === target && facing(bot, target) }
    },
    collect: (uuid, opts) => move(uuid, { ...opts, radiusMax: 8 }, false, true),
    gather: async () => ({ verified: false }), returnHome: async () => ({ verified: false }), halt: () => halt(false)
  } })
  function pathUpdate(result) {
    const task = active
    if (!task || task.finishing || task.pickedUp) return
    // 2.4.5 keeps and shifts this exact array after emitting path_update. Retaining
    // its reference makes path[0] the actual next step at each control call.
    task.path = result?.path
    task.proposedStep = null
    if (result?.status === 'partial' && Array.isArray(task.path) && !task.path.some(p => p.toBreak?.length || p.toPlace?.length)) {
      task.partial = true; task.path = null; clearWaitingControls(); void check(task); return
    }
    task.partial = false
    if (!Array.isArray(task.path) || result.status !== 'success' ||
        task.path.some(p => p.toBreak?.length || p.toPlace?.length)) rejectMovement(task, null, 'UNKNOWN_STATE')
    else {
      if (waitingForRoute(task)) clearWaitingControls()
      void check(task)
    }
  }
  function pathReset(reason) {
    if (!active || active.finishing || active.haltState) return
    active.path = null
    active.partial = false
    if (reason !== 'goal_updated') active.proposedStep = null
    haltingDepth++
    try { originalClear() } finally { haltingDepth-- }
    if (reason === 'stuck') rejectMovement(active, null, 'UNKNOWN_STATE')
  }
  function tick() {
    const task = active
    if (!task || task.finishing) return
    const target = Object.values(bot.players ?? {}).find(p => normalizeUuid(p.uuid) === normalizeUuid(commanderUuid))?.entity
    const p = bot.entity?.position
    if (!p || target !== task.target || p.distanceTo(task.start) > task.radius || p.distanceTo(target.position) > task.radius) {
      task.cancel?.('MOVEMENT_BOUNDARY'); task.finish(false, 'MOVEMENT_BOUNDARY'); return
    }
    if (waitingForRoute(task)) clearWaitingControls()
    if (task.collect && task.pickedUp) {
      const after = inventoryCounts(bot)
      const delta = after ? (after.get(task.drop.name) ?? 0) - (task.before.get(task.drop.name) ?? 0) : 0
      if (delta > 0 && delta <= task.drop.count && guard(task)) {
        report('gameplay_pickup', { item: task.drop.name, delta })
        task.finish(true); return
      }
    }
    if (guard(task) && !task.finishing && !task.partial && task.destination && !task.follow && !task.collect && p.distanceTo(task.destination) <= 2.5) task.finish(true)
    void check(task)
  }
  // goal_reached is emitted for static come-here goals; follow stays active.
  function goalReached() {
    const task = active
    if (task && !task.partial && !task.follow && !task.collect && bot.entity?.position?.distanceTo(task.destination) <= 2.5 && guard(task)) task.finish(true)
  }
  let lastChatIndex = -1
  let commandSequence = 0
  let goalAbort = null
  function cancelGoal() { goalAbort?.abort(); goalAbort = null }
  async function playerChat(packet) {
    const { allowSupervisedClockSkew, ...wire } = options.chatWire.take(packet)
    if (!isCommandCandidate(packet?.plainMessage)) return
    const command = parseCommand(packet.plainMessage)
    const request = options.inference ? goalRequest(packet.plainMessage) : null
    const index = packet.globalIndex
    const indexValid = Number.isSafeInteger(index) && index >= 0
    const checks = {
      encryptedTransport: Boolean(bot._client.cipher),
      commanderMatched: normalizeUuid(packet.sender) === normalizeUuid(commanderUuid),
      commanderInRoster: Object.values(bot.players ?? {}).some(p => normalizeUuid(p.uuid) === normalizeUuid(commanderUuid)),
      indexPresent: index !== undefined && index !== null,
      indexValid,
      indexFresh: indexValid && index > lastChatIndex,
      commandParsed: movementCommands.has(command?.kind) || request !== null
    }
    const signatureVerified = packet.verified === true
    const signatureAccepted = signatureVerified || (policy === 'supervised-dry' && allowSupervisedClockSkew === true)
    const envelope = commandEnvelope({ sender: packet.sender, plainMessage: packet.plainMessage,
      authenticated: signatureAccepted && Object.values(checks).every(Boolean) && wire.packedSignaturesResolved !== false }, commanderUuid)
    if (!envelope) {
      report('movement_ignored', { signatureVerified, ...checks, ...wire })
      return
    }
    lastChatIndex = index
    const kind = request ? 'ask' : command.kind
    const sequence = ++commandSequence
    cancelGoal()
    if (kind !== 'stop' && controller.activeTaskId !== null) {
      const previous = await controller.stop()
      if (sequence !== commandSequence || !previous.stopped) return
    }
    if (sequence !== commandSequence || disconnected || disposed) return
    if (request) {
      const ac = new AbortController()
      goalAbort = ac
      const current = () => sequence === commandSequence && !disconnected && !disposed && goalAbort === ac
      report('goal_admitted', {})
      try {
        await runGoal({ request, provider: options.inference, signal: ac.signal, current,
          observe: () => observeGameplay(bot, commanderEntity()),
          report, reply: text => { if (current() && !ac.signal.aborted) { try { bot.chat(text) } catch {} } },
          execute: async (text, action) => {
            if (!current() || ac.signal.aborted) return {state:'CANCELLED'}
            const result = await controller.handle({...envelope,text})
            if (!current() || ac.signal.aborted) return {state:'CANCELLED'}
            const kind = action === 'come' ? 'comeHere' : action
            const reply = commandReply(kind,result)
            if (reply) { try { bot.chat(reply) } catch {} }
            if (!result.accepted) return {state:'REJECTED',reason:result.reason}
            if (action === 'stop') return {state:result.stopped ? 'COMPLETED' : 'FAILED',reason:result.reason}
            const final = await result.completion
            report('movement_result', {kind,state:final.state,reason:final.reason,haltState:final.haltState,movementStopped:false})
            return final
          }
        })
      } finally { if (goalAbort === ac) goalAbort = null }
      return
    }
    const result = await controller.handle(envelope)
    report('movement_command', { kind, accepted: result.accepted, stopped: result.stopped,
      reason: result.reason, haltState: result.haltState, movementStopped: false })
    const reply = commandReply(kind, result)
    if (reply) { try { bot.chat(reply) } catch {} }
    if (result.completion) {
      const final = await result.completion
      report('movement_result', { kind, state: final.state, reason: final.reason, haltState: final.haltState, movementStopped: false })
      if (['look','collect'].includes(kind) && sequence === commandSequence && !disconnected && !disposed) {
        try { bot.chat(final.state === 'COMPLETED' ? (kind === 'look' ? 'Looking at you.' : 'Pickup verified.') : 'Action not verified.') } catch {}
      }
    }
  }
  function stateChanged() { if (active) void check(active) }
  function end() {
    cancelGoal()
    disconnected = true
    if (active) { active.cancel?.('DISCONNECTED'); active?.finish(false, 'DISCONNECTED') }
    try { halt() } catch {}
    dispose()
  }
  function shutdown() {
    cancelGoal()
    disconnected = true
    commandSequence++
    if (active) { active.cancel?.('SHUTDOWN'); active?.finish(false, 'SHUTDOWN') }
    try { halt() } catch {}
  }
  function dispose() {
    cancelGoal()
    if (disposed) return
    disposed = true
    bot._client.removeListener('playerChat', onPlayerChat)
    options.chatWire.dispose()
    for (const name of ['blockUpdate', 'entityMoved', 'entitySpawn', 'entityGone', 'entityUpdate', 'chunkColumnUnload', 'chunkColumnLoad']) bot.removeListener(name, stateChanged)
    bot.removeListener('path_update', pathUpdate); bot.removeListener('path_reset', pathReset)
    bot.removeListener('physicsTick', tick); bot.removeListener('goal_reached', goalReached)
    options.signal?.removeEventListener('abort', shutdown)
    bot.removeListener('death', shutdown)
    bot.removeListener('respawn', shutdown)
    telemetry.dispose()
    // Keep the synchronous guard installed: callbacks already queued by a plugin
    // must not regain access to ordinary controls after disconnect/disposal.
  }
  bot.on('path_update', pathUpdate); bot.on('path_reset', pathReset)
  bot.prependListener('physicsTick', tick); bot.on('goal_reached', goalReached)
  for (const name of ['blockUpdate', 'entityMoved', 'entitySpawn', 'entityGone', 'entityUpdate', 'chunkColumnUnload', 'chunkColumnLoad']) bot.on(name, stateChanged)
  const onPlayerChat = packet => { void playerChat(packet).catch(() => shutdown()) }
  bot._client.on('playerChat', onPlayerChat)
  bot.once('end', end)
  bot.once('death', shutdown)
  bot.once('respawn', shutdown)
  options.signal?.addEventListener('abort', shutdown, { once: true })
  if (options.signal?.aborted) shutdown()
  halt.controller = controller
  halt.dispose = dispose
  return halt
}

// Mineflayer createBot returns before plugins/registry/entity finish loading.
// Observe protocol metadata immediately, initialize pathfinder only after spawn.
export function enableMovement(bot, commanderUuid, report, options = {}) {
  const telemetry = options.telemetry ?? createTelemetry(bot, { now: options.now ?? Date.now, policy: options.policy ?? 'strict' })
  const chatWire = observeChatWire(bot._client)
  let installed
  let closing = false
  const initialize = () => {
    if (closing || options.signal?.aborted) return
    try { installed = installMovement(bot, commanderUuid, report, { ...options, telemetry, chatWire }) }
    catch {
      closing = true
      telemetry.dispose()
      chatWire.dispose()
      try { bot.clearControlStates?.() } catch {}
      try { report('movement_unavailable', { reason: 'MOVEMENT_SETUP_FAILED' }) } catch {}
      // verifyConnection installs its error handler once createBot returns.
      queueMicrotask(() => {
        if (bot.listenerCount('error') > 0) bot.emit('error', new Error('MOVEMENT_SETUP_FAILED'))
      })
    }
  }
  if (bot.entity && bot.registry) initialize()
  else bot.once('spawn', initialize)
  const halt = () => {
    if (installed) return installed()
    bot.clearControlStates?.()
  }
  const shutdown = () => {
    closing = true
    bot.removeListener('spawn', initialize)
    try { halt() } catch {
      // Remain closed even when the transport cannot acknowledge a halt.
      installed?.dispose()
      telemetry.dispose()
    }
  }
  options.signal?.addEventListener('abort', shutdown, { once: true })
  bot.once('end', () => { try { shutdown() } finally { telemetry.dispose(); chatWire.dispose() } })
  halt.dispose = () => {
    closing = true
    bot.removeListener('spawn', initialize)
    try { halt() }
    finally {
      installed?.dispose(); telemetry.dispose(); chatWire.dispose()
      options.signal?.removeEventListener('abort', shutdown)
    }
  }
  Object.defineProperty(halt, 'controller', { get: () => installed?.controller })
  if (options.signal?.aborted) shutdown()
  return halt
}
