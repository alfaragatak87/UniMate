const contractsModule = import('../../shared/ai/budgetTransportContracts.mjs');
const validationModule = import('../../shared/ai/budgetTransportValidation.mjs');

const ERROR_CODES = new Set([
  'invalid_request',
  'confirmation_failed',
  'storage_unavailable',
  'operation_failed',
]);

class AIBudgetControllerError extends Error {
  constructor(code) {
    super('Operasi budget AI tidak dapat diselesaikan.');
    this.name = 'AIBudgetControllerError';
    this.code = ERROR_CODES.has(code) ? code : 'operation_failed';
  }
}

function mapGuardError() {
  return new AIBudgetControllerError('storage_unavailable');
}

function createAIBudgetController(options = {}) {
  const { budgetGuard, confirmMutation } = options;
  if (
    typeof budgetGuard?.getStatus !== 'function'
    || typeof budgetGuard?.configurePolicy !== 'function'
    || typeof confirmMutation !== 'function'
  ) {
    throw new TypeError('Controller budget AI tidak valid');
  }
  let mutationQueue = Promise.resolve();

  function serializeMutation(operation) {
    const pending = mutationQueue.then(operation, operation);
    mutationQueue = pending.catch(() => undefined);
    return pending;
  }

  async function readSafeStatus() {
    let status;
    try {
      status = await budgetGuard.getStatus();
    } catch {
      throw mapGuardError();
    }
    const safeStatus = Object.freeze({
      configured: status?.configured,
      approved: status?.approved,
      dailyLimitMicrousd: status?.dailyLimitMicrousd,
      monthlyLimitMicrousd: status?.monthlyLimitMicrousd,
      dailyUsedMicrousd: status?.dailyUsedMicrousd,
      monthlyUsedMicrousd: status?.monthlyUsedMicrousd,
      pendingReservations: status?.pendingReservations,
      periodTimezone: status?.periodTimezone,
      accountingBasis: 'conservative_estimate',
      billingGuarantee: false,
    });
    const [{ AI_BUDGET_RESPONSE_OPERATIONS, AI_BUDGET_TRANSPORT_VERSION }, validation] = await Promise.all([
      contractsModule,
      validationModule,
    ]);
    const response = Object.freeze({
      schemaVersion: AI_BUDGET_TRANSPORT_VERSION,
      operation: AI_BUDGET_RESPONSE_OPERATIONS.STATUS,
      status: safeStatus,
    });
    try {
      validation.assertValidAIBudgetTransportResponse(response);
    } catch {
      throw new AIBudgetControllerError('operation_failed');
    }
    return response;
  }

  async function configure(request) {
    const contracts = await contractsModule;
    const current = await readSafeStatus();
    const action = current.status.configured
      ? contracts.AI_BUDGET_CONFIRMATION_ACTIONS.REPLACE
      : contracts.AI_BUDGET_CONFIRMATION_ACTIONS.CONFIGURE;
    let confirmed;
    try {
      confirmed = await confirmMutation(Object.freeze({
        action,
        dailyLimitMicrousd: request.dailyLimitMicrousd,
        monthlyLimitMicrousd: request.monthlyLimitMicrousd,
      }));
    } catch {
      throw new AIBudgetControllerError('confirmation_failed');
    }
    if (typeof confirmed !== 'boolean') throw new AIBudgetControllerError('confirmation_failed');
    const operation = action === contracts.AI_BUDGET_CONFIRMATION_ACTIONS.CONFIGURE
      ? contracts.AI_BUDGET_RESPONSE_OPERATIONS.CONFIGURE
      : contracts.AI_BUDGET_RESPONSE_OPERATIONS.REPLACE;
    if (!confirmed) {
      return Object.freeze({
        schemaVersion: contracts.AI_BUDGET_TRANSPORT_VERSION,
        operation,
        outcome: contracts.AI_BUDGET_MUTATION_OUTCOMES.CANCELLED,
        changed: false,
      });
    }
    let result;
    try {
      result = await budgetGuard.configurePolicy({
        schemaVersion: 1,
        approved: true,
        consentVersion: request.consentVersion,
        dailyLimitMicrousd: request.dailyLimitMicrousd,
        monthlyLimitMicrousd: request.monthlyLimitMicrousd,
      });
    } catch {
      throw mapGuardError();
    }
    if (result?.configured !== true || result.consentVersion !== request.consentVersion) {
      throw new AIBudgetControllerError('operation_failed');
    }
    return Object.freeze({
      schemaVersion: contracts.AI_BUDGET_TRANSPORT_VERSION,
      operation,
      outcome: contracts.AI_BUDGET_MUTATION_OUTCOMES.COMPLETED,
      changed: true,
    });
  }

  async function execute(request) {
    const [contracts, validation] = await Promise.all([contractsModule, validationModule]);
    try {
      validation.assertValidAIBudgetTransportRequest(request);
    } catch {
      throw new AIBudgetControllerError('invalid_request');
    }
    if (request.operation === contracts.AI_BUDGET_TRANSPORT_OPERATIONS.STATUS) return readSafeStatus();
    const safeRequest = Object.freeze({
      consentVersion: request.consentVersion,
      dailyLimitMicrousd: request.dailyLimitMicrousd,
      monthlyLimitMicrousd: request.monthlyLimitMicrousd,
    });
    const response = await serializeMutation(() => configure(safeRequest));
    try {
      validation.assertValidAIBudgetTransportResponse(response);
    } catch {
      throw new AIBudgetControllerError('operation_failed');
    }
    return response;
  }

  return Object.freeze({ execute });
}

module.exports = {
  AIBudgetControllerError,
  createAIBudgetController,
};
