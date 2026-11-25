import { parseCommand, validateEnvelope, UUID_RE } from './commands.js';

const LIMITS = Object.freeze({ followMs: 60_000, comeHereMs: 30_000, gatherMs: 90_000, returnMs: 30_000,
  statusMs: 2_000, lookMs: 5_000, collectMs: 20_000, haltMs: 1_000, stopWaitMs: 5_000 });

// Bound caller-owned promises without trusting them to cooperate with cancellation.
// The original promises retain rejection handlers even after the deadline wins.
function bounded(promise, timeoutMs, fallback) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise(resolve => { timer = setTimeout(() => resolve(fallback), timeoutMs); })
  ]).finally(() => clearTimeout(timer));
}

function reasonText(reason) {
  return String(reason?.message ?? reason ?? 'CANCELLED').slice(0, 100);
}

export class SaraController {
  #adapter;
  #commander;
  #limits;
  #active = null;
  #seq = 0;
  #events = [];
  #blocked = false;
  #idleStop = null;

  constructor({ adapter, commanderUuid, limits = {} }) {
    if (!adapter || !['follow', 'gather', 'returnHome', 'halt'].every(k => typeof adapter[k] === 'function')) {
      throw new Error('adapter requires follow, gather, returnHome, halt functions');
    }
    if (!UUID_RE.test(commanderUuid)) throw new Error('Invalid commander UUID');
    // Tests and stricter deployments may shorten deadlines, never silently extend them.
    for (const [key, value] of Object.entries(limits)) {
      if (!Object.hasOwn(LIMITS, key) || !Number.isSafeInteger(value) || value < 1 || value > LIMITS[key]) {
        throw new Error('Invalid controller limit');
      }
    }
    this.#adapter = adapter;
    this.#commander = commanderUuid.toLowerCase();
    this.#limits = { ...LIMITS, ...limits };
  }

  get events() { return this.#events.map(event => ({ ...event })); }
  get activeTaskId() { return this.#active?.id ?? null; }
  #record(task, state, reason = '', details = {}) {
    const event = Object.freeze({ taskId: task.id, kind: task.command.kind, state, reason,
      at: new Date().toISOString(), ...details });
    this.#events.push(event);
    return event;
  }

  #finish(task, state, reason = '', details = {}) {
    if (task.terminal) return;
    clearTimeout(task.timer);
    task.terminal = this.#record(task, state, reason, details);
    if (this.#active === task) this.#active = null;
    task.resolve(task.terminal);
  }

  #halt() {
    let request;
    try { request = this.#adapter.halt(); }
    catch { return Promise.resolve('failed'); }
    return bounded(Promise.resolve(request).then(result => {
      // A transport may itself report an unsuccessful bounded halt.
      return ['failed', 'timed_out'].includes(result?.haltState) ? result.haltState : 'acknowledged';
    }, () => 'failed'), this.#limits.haltMs, 'timed_out');
  }

  #cancel(task, reason) {
    if (task.terminal || task.cancelReason !== null) return;
    // Publish the first reason before abort callbacks can re-enter the controller.
    task.cancelReason = reasonText(reason);
    clearTimeout(task.timer);
    task.abort.abort(new Error(task.cancelReason));
    const halt = this.#halt();
    const settlement = bounded(task.execution.then(() => true), this.#limits.stopWaitMs, false);
    Promise.all([halt, settlement]).then(([haltState, executionSettled]) => {
      // An uncooperative operation can still be running after we report a terminal
      // task. Quarantine this controller instance so it cannot authorize replacement.
      if (!executionSettled || haltState !== 'acknowledged') this.#blocked = true;
      this.#finish(task, task.cancelReason === 'TIME_LIMIT' ? 'TIMED_OUT' : 'CANCELLED', task.cancelReason,
        { haltState, executionSettled, movementStopped: false });
    });
  }

  async handle(envelope) {
    if (!validateEnvelope(envelope, this.#commander)) return { accepted: false, reason: 'UNAUTHORIZED' };
    const command = parseCommand(envelope.text);
    if (!command) return { accepted: false, reason: 'UNKNOWN_COMMAND' };
    if (command.kind === 'stop') return this.stop();
    if (this.#blocked) return { accepted: false, reason: 'HALT_UNCONFIRMED' };
    if (this.#active || this.#idleStop) return { accepted: false, reason: 'BUSY' };

    const task = { id: ++this.#seq, command, abort: new AbortController(), cancelReason: null };
    task.promise = new Promise(resolve => { task.resolve = resolve; });
    task.execution = new Promise(resolve => { task.executionDone = resolve; });
    this.#active = task;
    this.#record(task, 'AUTHORIZED');
    task.timer = setTimeout(() => this.#cancel(task, 'TIME_LIMIT'), this.#limits[`${command.kind}Ms`]);
    this.#record(task, 'RUNNING');
    const options = { signal: task.abort.signal, radiusMax: 32, cancel: reason => this.#cancel(task, reason) };
    let execution;
    try {
      switch (command.kind) {
        case 'status': execution = this.#adapter.status?.(this.#commander, options); break;
        case 'look': execution = this.#adapter.look?.(this.#commander, options); break;
        case 'collect': execution = this.#adapter.collect?.(this.#commander, options); break;
        case 'follow': execution = this.#adapter.follow(this.#commander, options); break;
        case 'comeHere': execution = this.#adapter.comeHere?.(this.#commander, options); break;
        case 'gather': execution = this.#adapter.gather(command.block, command.count, { ...options, radiusMax: 48 }); break;
        case 'return': execution = this.#adapter.returnHome(options); break;
      }
    } catch (error) { execution = Promise.reject(error); }
    Promise.resolve(execution).then(result => {
      task.executionDone();
      if (task.cancelReason !== null || task.terminal) return;
      this.#finish(task, result?.verified === true ? 'COMPLETED' : 'FAILED', result?.verified === true ? '' : 'NOT_VERIFIED');
    }, error => {
      task.executionDone();
      if (task.cancelReason !== null || task.terminal) return;
      this.#finish(task, 'FAILED', reasonText(error));
    });
    return { accepted: true, taskId: task.id, completion: task.promise };
  }

  async stop() {
    const task = this.#active;
    if (task) {
      this.#cancel(task, 'STOP');
      const final = await task.promise;
      return { accepted: true, stopped: final.executionSettled === true && final.haltState === 'acknowledged',
        taskId: task.id, reason: final.reason, haltState: final.haltState,
        executionSettled: final.executionSettled, movementStopped: false };
    }
    // Even idle STOP clears transport goals and controls. Concurrent requests share
    // one bounded attempt; acknowledgement says nothing about physical cessation.
    if (!this.#idleStop) {
      this.#idleStop = this.#halt().then(haltState => {
        if (haltState !== 'acknowledged') this.#blocked = true;
        return { accepted: true, stopped: haltState === 'acknowledged' && !this.#blocked,
          taskId: null, haltState, executionSettled: true, movementStopped: false };
      }).finally(() => { this.#idleStop = null; });
    }
    return this.#idleStop;
  }
}
