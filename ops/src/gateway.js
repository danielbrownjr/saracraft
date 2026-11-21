import { authorize } from './policy.js';

// This service can invoke only fixed method names, never a shell or raw server console.
const METHOD = Object.freeze({
  health: 'health', players: 'players', backup: 'backup',
  allowlist_add: 'allowlistAdd', allowlist_remove: 'allowlistRemove', restart: 'restart'
});
export class OpsGateway {
  #backend;
  #audit;
  #seen = new Set();
  #busy = false;
  constructor({ backend, audit }) {
    if (!backend || Object.values(METHOD).some(m => typeof backend[m] !== 'function')) throw Error('INVALID_BACKEND');
    if (typeof audit !== 'function') throw Error('AUDIT_REQUIRED');
    this.#backend = backend;
    this.#audit = audit;
  }
  async execute(request, { principal, confirmation } = {}) {
    let op;
    try { op = authorize(request, principal, confirmation); }
    catch (err) {
      await this.#audit({ requestId: 'invalid', action: 'invalid', principalId: null, status: 'rejected', at: new Date().toISOString() });
      throw err;
    }
    if (this.#seen.has(op.requestId)) throw Error('DUPLICATE_REQUEST');
    if (this.#busy) throw Error('BUSY');
    this.#seen.add(op.requestId);
    this.#busy = true;
    try {
      const result = await this.#backend[METHOD[op.action]](op.args);
      await this.#audit({ requestId: op.requestId, action: op.action, principalId: principal.id, status: 'success', at: new Date().toISOString() });
      return { requestId: op.requestId, action: op.action, ok: true, result };
    } catch (err) {
      await this.#audit({ requestId: op.requestId, action: op.action, principalId: principal.id, status: 'failed', at: new Date().toISOString() });
      throw err;
    } finally { this.#busy = false; }
  }
}
