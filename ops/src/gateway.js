import { authorize, validateRequest } from './policy.js';
import { TrustRoot } from './trust.js';

// This service can invoke only fixed method names, never a shell or raw server console.
const METHOD = Object.freeze({
  health: 'health', players: 'players', backup: 'backup',
  allowlist_add: 'allowlistAdd', allowlist_remove: 'allowlistRemove', restart: 'restart'
});
// Gateway-side deadlines. The privileged helper must still enforce its own hard kill timeout,
// because a deadline here cannot prove that a backend operation has actually stopped.
export const DEADLINE_MS = Object.freeze({
  health: 10_000, players: 10_000, backup: 600_000,
  allowlist_add: 15_000, allowlist_remove: 15_000, restart: 180_000
});

function safeAction(request) {
  try { return validateRequest(request).action; } catch { return 'invalid'; }
}

export class OpsGateway {
  #backend;
  #audit;
  #trust;
  #seen = new Set();
  #busy = false;
  constructor({ backend, audit, trust }) {
    if (!backend || Object.values(METHOD).some(m => typeof backend[m] !== 'function')) throw Error('INVALID_BACKEND');
    if (typeof audit !== 'function') throw Error('AUDIT_REQUIRED');
    if (!(trust instanceof TrustRoot)) throw Error('TRUST_ROOT_REQUIRED');
    this.#backend = backend;
    this.#audit = audit;
    this.#trust = trust;
  }
  #record(op, principalId, status) {
    return this.#audit({ requestId: op?.requestId ?? 'invalid', action: op?.action ?? 'invalid',
      principalId: principalId ?? null, status, at: new Date().toISOString() });
  }
  async execute(request, { principal, confirmation } = {}) {
    let op;
    try { op = authorize(request, principal, confirmation, this.#trust); }
    catch (err) {
      await this.#record({ action: safeAction(request) }, this.#trust.isPrincipal(principal) ? principal.id : null, 'rejected');
      throw err;
    }
    if (this.#seen.has(op.requestId)) { await this.#record(op, principal.id, 'rejected_duplicate'); throw Error('DUPLICATE_REQUEST'); }
    if (this.#busy) { await this.#record(op, principal.id, 'rejected_busy'); throw Error('BUSY'); }
    this.#busy = true;
    // Write-ahead record: an operation that cannot be audited is never started.
    try { await this.#record(op, principal.id, 'started'); }
    catch { this.#busy = false; throw Error('AUDIT_UNAVAILABLE'); }
    this.#seen.add(op.requestId);

    const ac = new AbortController();
    let timer;
    const work = Promise.resolve().then(() => this.#backend[METHOD[op.action]](op.args, { signal: ac.signal }));
    // Keep the lock until the backend actually settles, even after a timeout,
    // so a stuck restart/backup cannot overlap a second operation.
    work.then(() => {}, () => {}).finally(() => { this.#busy = false; });
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { ac.abort(Error('TIME_LIMIT')); reject(Error('OPERATION_TIMED_OUT')); }, DEADLINE_MS[op.action]);
      timer.unref?.();
    });
    let outcome, result, failure;
    try { result = await Promise.race([work, deadline]); outcome = 'success'; }
    catch (err) { failure = err; outcome = err?.message === 'OPERATION_TIMED_OUT' ? 'timed_out' : 'failed'; }
    finally { clearTimeout(timer); }
    try { await this.#record(op, principal.id, outcome); }
    catch { throw Object.assign(Error('AUDIT_INCOMPLETE'), { requestId: op.requestId, outcome }); }
    if (failure) throw failure;
    return { requestId: op.requestId, action: op.action, ok: true, result };
  }
}
