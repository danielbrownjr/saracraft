// Deterministic safety gate for a future Mineflayer movement adapter.
// Call before starting a movement goal and repeatedly while it is active.
// The adapter must provide fresh, measured world-state snapshots.
export function assessNavigation(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' ||
      typeof snapshot.inWater !== 'boolean' ||
      typeof snapshot.nextStepInWater !== 'boolean' ||
      typeof snapshot.creeperDistance !== 'number' ||
      !Number.isFinite(snapshot.creeperDistance) ||
      snapshot.creeperDistance < 0 ||
      !Number.isInteger(snapshot.air) ||
      snapshot.air < 0 || snapshot.air > 300) {
    return { safe: false, reason: 'UNKNOWN_STATE' };
  }
  if (snapshot.air < 100) return { safe: false, reason: 'LOW_AIR' };
  if (snapshot.inWater || snapshot.nextStepInWater) return { safe: false, reason: 'WATER_UNSAFE' };
  if (snapshot.creeperDistance <= 6) return { safe: false, reason: 'CREEPER_NEARBY' };
  return { safe: true };
}

// One monitor per movement task. There is deliberately no timer here:
// a real adapter must own its sampling cadence, freshness and lifecycle.
export class NavigationSafetyMonitor {
  #readState;
  #halt;
  #tripped = null;

  constructor({ readState, halt }) {
    if (typeof readState !== 'function' || typeof halt !== 'function') {
      throw new TypeError('readState and halt functions are required');
    }
    this.#readState = readState;
    this.#halt = halt;
  }

  get tripped() { return this.#tripped && { ...this.#tripped }; }

  async check({ signal } = {}) {
    if (this.#tripped) return { ...this.#tripped };
    let verdict;
    if (signal?.aborted) {
      verdict = { safe: false, reason: 'CANCELLED' };
    } else {
      try {
        verdict = assessNavigation(await this.#readState());
      } catch {
        verdict = { safe: false, reason: 'STATE_UNAVAILABLE' };
      }
      if (signal?.aborted) verdict = { safe: false, reason: 'CANCELLED' };
    }
    if (verdict.safe) return { safe: true };

    // Set the terminal result before awaiting halt, preventing concurrent
    // checks from issuing competing halt commands.
    this.#tripped = { safe: false, reason: verdict.reason, haltConfirmed: false };
    try {
      await this.#halt();
      this.#tripped = { ...this.#tripped, haltConfirmed: true };
    } catch {
      // A failed halt is not a successful safety intervention.
    }
    return { ...this.#tripped };
  }
}
