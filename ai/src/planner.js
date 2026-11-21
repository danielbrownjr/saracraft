import { validateProposal } from './schemas.js';
const GUIDE={
  ops:'health, players, backup, allowlist_add(username), allowlist_remove(username), restart',
  game:'follow, stop, return, gather(block,count); supported blocks oak_log, spruce_log, birch_log; count 1-32'
};
export class IntentPlanner {
  #provider;
  constructor({provider}) { if(typeof provider?.complete !== 'function') throw Error('INVALID_PROVIDER'); this.#provider=provider; }
  async propose({text,scope,signal}) {
    // Own-property check: inherited keys such as 'constructor' must be rejected before any inference spend.
    if(typeof text !== 'string' || text.length < 1 || text.length > 500 || typeof scope !== 'string' || !Object.hasOwn(GUIDE,scope)) throw Error('INVALID_INPUT');
    const system=`Classify user request into exactly one of: ${GUIDE[scope]}. Return ONLY JSON with action and args. For unsupported or ambiguous requests use {"action":"none","args":{}}. Never return code. Your answer is a proposal, not authorization.`;
    const raw=await this.#provider.complete([{role:'system',content:system},{role:'user',content:text}],signal);
    let decoded; try { decoded=JSON.parse(raw); } catch { throw Error('INVALID_MODEL_JSON'); }
    return validateProposal(decoded,scope);
  }
}
