import { parseCommand, validateEnvelope, UUID_RE } from './commands.js';

const LIMITS = Object.freeze({ followMs: 60_000, gatherMs: 90_000, returnMs: 30_000, stopWaitMs: 5_000 });
const TERMINAL = new Set(['COMPLETED', 'CANCELLED', 'FAILED', 'TIMED_OUT']);

export class SaraController {
  #adapter;
  #commander;
  #active = null;
  #seq = 0;
  #events = [];

  constructor({ adapter, commanderUuid }) {
    if (!adapter || !['follow', 'gather', 'returnHome', 'halt'].every(k => typeof adapter[k] === 'function')) {
      throw new Error('adapter requires follow, gather, returnHome, halt functions');
    }
    if (!UUID_RE.test(commanderUuid)) throw new Error('Invalid commander UUID');
    this.#adapter = adapter;
    this.#commander = commanderUuid.toLowerCase();
  }

  get events() { return this.#events.map(event => ({ ...event })); }
  get activeTaskId() { return this.#active?.id ?? null; }
  #record(task, state, reason = '') {
    this.#events.push(Object.freeze({ taskId: task.id, kind: task.command.kind, state, reason, at: new Date().toISOString() }));
  }

  async handle(envelope) {
    if (!validateEnvelope(envelope, this.#commander)) return { accepted: false, reason: 'UNAUTHORIZED' };
    const command = parseCommand(envelope.text);
    if (!command) return { accepted: false, reason: 'UNKNOWN_COMMAND' };
    if (command.kind === 'stop') return this.stop();
    if (this.#active) return { accepted: false, reason: 'BUSY' };

    const task = { id: ++this.#seq, command, abort: new AbortController() };
    this.#active = task;
    this.#record(task, 'AUTHORIZED');
    const deadline = LIMITS[`${command.kind}Ms`];
    const timer = setTimeout(() => task.abort.abort(new Error('TIME_LIMIT')), deadline);
    timer.unref?.();
    const run = (async () => {
      try {
        this.#record(task, 'RUNNING');
        let result;
        switch (command.kind) {
          case 'follow': result = await this.#adapter.follow(this.#commander, { signal: task.abort.signal, radiusMax: 64 }); break;
          case 'gather': result = await this.#adapter.gather(command.block, command.count, { signal: task.abort.signal, radiusMax: 48 }); break;
          case 'return': result = await this.#adapter.returnHome({ signal: task.abort.signal }); break;
        }
        if (task.abort.signal.aborted) this.#record(task, task.abort.signal.reason?.message === 'TIME_LIMIT' ? 'TIMED_OUT' : 'CANCELLED');
        else if (result?.verified === true) this.#record(task, 'COMPLETED');
        else this.#record(task, 'FAILED', 'NOT_VERIFIED');
      } catch (err) {
        if (task.abort.signal.aborted) this.#record(task, task.abort.signal.reason?.message === 'TIME_LIMIT' ? 'TIMED_OUT' : 'CANCELLED');
        else this.#record(task, 'FAILED', String(err?.message ?? 'ADAPTER_ERROR').slice(0, 100));
      } finally {
        clearTimeout(timer);
        if (this.#active === task) this.#active = null;
      }
      return this.#events.filter(e => e.taskId === task.id).at(-1);
    })();
    task.promise = run;
    return { accepted: true, taskId: task.id, completion: run };
  }

  async stop() {
    const task = this.#active;
    if (!task) return { accepted: true, stopped: true, taskId: null };
    task.abort.abort(new Error('STOP'));
    // A transport halt is required even if the adapter ignores AbortSignal.
    try { await this.#adapter.halt(); } catch (err) { return { accepted: true, stopped: false, reason: 'HALT_FAILED', taskId: task.id }; }
    let timeout;
    const done = await Promise.race([
      task.promise.then(() => true),
      new Promise(resolve => { timeout = setTimeout(() => resolve(false), LIMITS.stopWaitMs); })
    ]);
    clearTimeout(timeout);
    const final = this.#events.filter(e => e.taskId === task.id).at(-1);
    return { accepted: true, stopped: done && TERMINAL.has(final?.state) && final.state !== 'COMPLETED', taskId: task.id };
  }
}
