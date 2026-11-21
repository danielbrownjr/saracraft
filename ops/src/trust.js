// In-process trust root. Only the holder of a TrustRoot (the future authenticated
// transport) can mint principals and confirmations; deserialized or model-generated
// objects are never registered and therefore never verify, whatever their fields say.
// This is a capability boundary inside one process, NOT a substitute for the
// separately authenticated local transport and privileged-helper isolation.
const PRINCIPAL_ID = /^[a-z0-9_-]{1,64}$/;

export class TrustRoot {
  #principals = new WeakSet();
  #confirmations = new WeakSet();
  #now;
  constructor({ now = () => Date.now() } = {}) {
    if (typeof now !== 'function') throw Error('INVALID_CLOCK');
    this.#now = now;
  }
  now() { return this.#now(); }
  issuePrincipal({ id, role }) {
    if (typeof id !== 'string' || !PRINCIPAL_ID.test(id)) throw Error('INVALID_PRINCIPAL_ID');
    if (role !== 'saracraft_operator') throw Error('INVALID_ROLE');
    const principal = Object.freeze({ id, role });
    this.#principals.add(principal);
    return principal;
  }
  issueConfirmation({ requestId, action, approvedBy, ttlMs = 120_000 }) {
    if (!this.isPrincipal(approvedBy)) throw Error('INVALID_APPROVER');
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 300_000) throw Error('INVALID_TTL');
    const confirmation = Object.freeze({ requestId, action, approvedBy: approvedBy.id, expiresAt: this.#now() + ttlMs });
    this.#confirmations.add(confirmation);
    return confirmation;
  }
  isPrincipal(value) { return typeof value === 'object' && value !== null && this.#principals.has(value); }
  isConfirmation(value) { return typeof value === 'object' && value !== null && this.#confirmations.has(value); }
}
