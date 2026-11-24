// Source-only safety gate. Telemetry must come from a fresh, complete world snapshot.
export function assessNavigation(snapshot, { now = Date.now(), maxAgeMs = 1000, policy = 'strict' } = {}) {
  if (!['strict', 'supervised-dry'].includes(policy)) return { safe: false, reason: 'UNKNOWN_STATE' };
  const supervised = policy === 'supervised-dry';
  if (!snapshot || typeof snapshot !== 'object') return { safe: false, reason: 'UNKNOWN_STATE' };
  const { air, inWater, nextStepInWater, creeperDistance, entitiesObserved } = snapshot;
  const observedAt = supervised ? snapshot.sampledAt : snapshot.observedAt;
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0 ||
      !Number.isFinite(observedAt) || observedAt > now || now - observedAt > maxAgeMs ||
      typeof inWater !== 'boolean' || typeof nextStepInWater !== 'boolean' ||
      entitiesObserved !== true ||
      ((!supervised || air !== undefined) && (!Number.isInteger(air) || air < 0 || air > 300)) ||
      !(creeperDistance === null ||
        (typeof creeperDistance === 'number' && Number.isFinite(creeperDistance) && creeperDistance >= 0))) {
    return { safe: false, reason: 'UNKNOWN_STATE' };
  }
  // Already in water is an emergency requiring an adapter-provided escape.
  // Halting alone is not a safe submerged recovery.
  if (inWater) return { safe: false, reason: 'WATER_EXIT_REQUIRED', action: 'surface' };
  if (air !== undefined && air < 100) return { safe: false, reason: 'LOW_AIR' };
  if (nextStepInWater) return { safe: false, reason: 'WATER_UNSAFE' };
  if (creeperDistance !== null && creeperDistance <= 6) {
    return { safe: false, reason: 'CREEPER_NEARBY' };
  }
  return { safe: true };
}

// All async interventions are bounded and first trip wins. A halt acknowledgement
// is not proof of stopped movement in the game world.
export class NavigationSafetyMonitor {
  #readState;
  #halt;
  #tripped = null;
  #tripPromise = null;
  #readTimeoutMs;
  #haltTimeoutMs;
  #maxAgeMs;
  #now;
  #policy;

  constructor({ readState, halt, readTimeoutMs = 400, haltTimeoutMs = 1000,
    maxAgeMs = 1000, now = Date.now, policy = 'strict' }) {
    if (typeof readState !== 'function' || typeof halt !== 'function' || typeof now !== 'function') {
      throw new TypeError('readState, halt and now functions are required');
    }
    if (![readTimeoutMs, haltTimeoutMs].every(v => Number.isFinite(v) && v > 0) ||
        !Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
      throw new RangeError('invalid deadlines or maximum snapshot age');
    }
    this.#readState = readState;
    this.#halt = halt;
    this.#readTimeoutMs = readTimeoutMs;
    this.#haltTimeoutMs = haltTimeoutMs;
    this.#maxAgeMs = maxAgeMs;
    if (!['strict', 'supervised-dry'].includes(policy)) throw new RangeError('invalid navigation policy');
    this.#policy = policy;
    this.#now = now;
  }

  get tripped() { return this.#tripped && { ...this.#tripped }; }

  // Race a potentially uncooperative adapter against abort and deadline.
  // Late completion/rejection cannot produce a safe verdict or an unhandled rejection.
  async #sample(signal) {
    if (signal?.aborted) return { safe: false, reason: 'CANCELLED' };
    let timer;
    let onAbort;
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => resolve({ kind: 'timeout' }), this.#readTimeoutMs);
    });
    const aborted = signal ? new Promise(resolve => {
      onAbort = () => resolve({ kind: 'abort' });
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    }) : new Promise(() => {});
    const sample = Promise.resolve().then(() => this.#readState({ signal }))
      .then(value => ({ kind: 'value', value }), () => ({ kind: 'error' }));
    try {
      const result = await Promise.race([sample, timeout, aborted]);
      if (signal?.aborted || result.kind === 'abort') return { safe: false, reason: 'CANCELLED' };
      if (result.kind !== 'value') return { safe: false, reason: 'STATE_UNAVAILABLE' };
      // Snapshot accessors and the injected clock can throw during disconnects.
      // Treat evaluation failure like a failed read so check() trips and halts.
      try {
        return assessNavigation(result.value, { now: this.#now(), maxAgeMs: this.#maxAgeMs, policy: this.#policy });
      } catch {
        return { safe: false, reason: 'STATE_UNAVAILABLE' };
      }
    } finally {
      clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  #trip(verdict) {
    if (this.#tripPromise) return this.#tripPromise;
    this.#tripped = { ...verdict, safe: false, haltState: 'pending' };
    this.#tripPromise = (async () => {
      let timer;
      const deadline = new Promise(resolve => {
        timer = setTimeout(() => resolve('timed_out'), this.#haltTimeoutMs);
      });
      const halt = Promise.resolve().then(() => this.#halt())
        .then(() => 'acknowledged', () => 'failed');
      try {
        const haltState = await Promise.race([halt, deadline]);
        this.#tripped = { ...this.#tripped, haltState };
        return { ...this.#tripped };
      } finally {
        clearTimeout(timer);
      }
    })();
    return this.#tripPromise;
  }

  async check({ signal } = {}) {
    if (this.#tripPromise) return { ...await this.#tripPromise };
    const verdict = await this.#sample(signal);
    // Another concurrent check may have tripped while our sampling was pending.
    if (this.#tripPromise) return { ...await this.#tripPromise };
    if (verdict.safe) return { safe: true };
    return { ...await this.#trip(verdict) };
  }
}
