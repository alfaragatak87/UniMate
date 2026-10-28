import {
  AI_BUDGET_ACCOUNTING_BASIS,
  AI_BUDGET_MAX_LIMIT_MICROUSD,
  AI_BUDGET_MUTATION_OUTCOMES,
  AI_BUDGET_RESPONSE_OPERATIONS,
  AI_BUDGET_TRANSPORT_OPERATIONS,
  AI_BUDGET_TRANSPORT_VERSION,
} from './budgetTransportContracts.mjs';

export class AIBudgetTransportValidationError extends Error {
  constructor() {
    super('Kontrak transport budget AI tidak valid.');
    this.name = 'AIBudgetTransportValidationError';
    this.code = 'invalid_budget_transport';
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every(key => keys.includes(key));
}

function validLimit(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= AI_BUDGET_MAX_LIMIT_MICROUSD;
}

function validUsed(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateStatus(status) {
  if (!exactKeys(status, [
    'configured', 'approved', 'dailyLimitMicrousd', 'monthlyLimitMicrousd',
    'dailyUsedMicrousd', 'monthlyUsedMicrousd', 'pendingReservations',
    'periodTimezone', 'accountingBasis', 'billingGuarantee',
  ])) return false;
  if (
    typeof status.configured !== 'boolean'
    || typeof status.approved !== 'boolean'
    || !validUsed(status.dailyUsedMicrousd)
    || !validUsed(status.monthlyUsedMicrousd)
    || !validUsed(status.pendingReservations)
    || status.periodTimezone !== 'UTC'
    || status.accountingBasis !== AI_BUDGET_ACCOUNTING_BASIS
    || status.billingGuarantee !== false
  ) return false;
  if (!status.configured) {
    return status.approved === false
      && status.dailyLimitMicrousd === null
      && status.monthlyLimitMicrousd === null;
  }
  return status.approved === true
    && validLimit(status.dailyLimitMicrousd)
    && validLimit(status.monthlyLimitMicrousd)
    && status.dailyLimitMicrousd <= status.monthlyLimitMicrousd;
}

export function validateAIBudgetTransportRequest(value) {
  if (!isPlainObject(value) || value.schemaVersion !== AI_BUDGET_TRANSPORT_VERSION) return false;
  if (value.operation === AI_BUDGET_TRANSPORT_OPERATIONS.STATUS) {
    return exactKeys(value, ['schemaVersion', 'operation']);
  }
  if (value.operation !== AI_BUDGET_TRANSPORT_OPERATIONS.CONFIGURE) return false;
  return exactKeys(value, [
    'schemaVersion', 'operation', 'approved', 'consentVersion',
    'dailyLimitMicrousd', 'monthlyLimitMicrousd',
  ])
    && value.approved === true
    && Number.isSafeInteger(value.consentVersion)
    && value.consentVersion > 0
    && validLimit(value.dailyLimitMicrousd)
    && validLimit(value.monthlyLimitMicrousd)
    && value.dailyLimitMicrousd <= value.monthlyLimitMicrousd;
}

export function validateAIBudgetTransportResponse(value) {
  if (!isPlainObject(value) || value.schemaVersion !== AI_BUDGET_TRANSPORT_VERSION) return false;
  if (value.operation === AI_BUDGET_RESPONSE_OPERATIONS.STATUS) {
    return exactKeys(value, ['schemaVersion', 'operation', 'status']) && validateStatus(value.status);
  }
  if (![AI_BUDGET_RESPONSE_OPERATIONS.CONFIGURE, AI_BUDGET_RESPONSE_OPERATIONS.REPLACE].includes(value.operation)) {
    return false;
  }
  return exactKeys(value, ['schemaVersion', 'operation', 'outcome', 'changed'])
    && Object.values(AI_BUDGET_MUTATION_OUTCOMES).includes(value.outcome)
    && typeof value.changed === 'boolean'
    && (value.outcome !== AI_BUDGET_MUTATION_OUTCOMES.CANCELLED || value.changed === false)
    && (value.outcome !== AI_BUDGET_MUTATION_OUTCOMES.COMPLETED || value.changed === true);
}

export function assertValidAIBudgetTransportRequest(value) {
  if (!validateAIBudgetTransportRequest(value)) throw new AIBudgetTransportValidationError();
  return value;
}

export function assertValidAIBudgetTransportResponse(value) {
  if (!validateAIBudgetTransportResponse(value)) throw new AIBudgetTransportValidationError();
  return value;
}
