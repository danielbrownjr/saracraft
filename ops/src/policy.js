// Typed operation proposals are not credentials or host authority.
const NAME = /^[A-Za-z0-9_]{3,16}$/;
const ACTIONS = new Set(['health', 'players', 'backup', 'allowlist_add', 'allowlist_remove', 'restart']);
const AUTO = new Set(['health', 'players', 'backup']);
const CONFIRM = new Set(['allowlist_remove', 'restart']);

export function validateRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw Error('INVALID_REQUEST');
  if (Object.keys(request).some(k => !['requestId', 'action', 'args'].includes(k))) throw Error('UNKNOWN_FIELD');
  if (typeof request.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(request.requestId)) throw Error('INVALID_ID');
  if (!ACTIONS.has(request.action)) throw Error('DENIED_ACTION');
  const args = request.args ?? {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('INVALID_ARGS');
  if (request.action.startsWith('allowlist_')) {
    if (Object.keys(args).length !== 1 || !NAME.test(args.username)) throw Error('INVALID_USERNAME');
  } else if (Object.keys(args).length) throw Error('UNEXPECTED_ARGS');
  return { requestId: request.requestId, action: request.action,
    args: request.action.startsWith('allowlist_') ? { username: args.username } : {},
    requiresConfirmation: CONFIRM.has(request.action), unattended: AUTO.has(request.action) };
}
export function authorize(request, principal, confirmation) {
  const operation = validateRequest(request);
  // Principal must come from an authenticated transport, not from LLM output.
  if (!principal || principal.authenticated !== true || principal.role !== 'saracraft_operator') throw Error('UNAUTHORIZED');
  if (operation.requiresConfirmation && (!confirmation ||
    confirmation.requestId !== operation.requestId || confirmation.action !== operation.action ||
    confirmation.approvedBy !== principal.id || confirmation.verified !== true)) throw Error('CONFIRMATION_REQUIRED');
  return operation;
}
