export const AI_BUDGET_TRANSPORT_VERSION = 1;

export const AI_BUDGET_TRANSPORT_OPERATIONS = Object.freeze({
  STATUS: 'status',
  CONFIGURE: 'configure',
});

export const AI_BUDGET_RESPONSE_OPERATIONS = Object.freeze({
  STATUS: 'status',
  CONFIGURE: 'configure',
  REPLACE: 'replace',
});

export const AI_BUDGET_CONFIRMATION_ACTIONS = Object.freeze({
  CONFIGURE: 'configure',
  REPLACE: 'replace',
});

export const AI_BUDGET_MUTATION_OUTCOMES = Object.freeze({
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

export const AI_BUDGET_ACCOUNTING_BASIS = 'conservative_estimate';
export const AI_BUDGET_MAX_LIMIT_MICROUSD = 1_000_000_000;
