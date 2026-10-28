import {
  AI_BUDGET_MAX_LIMIT_MICROUSD,
  AI_BUDGET_TRANSPORT_OPERATIONS,
  AI_BUDGET_TRANSPORT_VERSION,
} from '../../shared/ai/budgetTransportContracts.mjs';
import {
  validateAIBudgetTransportRequest,
  validateAIBudgetTransportResponse,
} from '../../shared/ai/budgetTransportValidation.mjs';

const SAFE_ERROR_CODES = new Set([
  'invalid_request',
  'ipc_sender_rejected',
  'mutation_disabled',
  'confirmation_failed',
  'storage_unavailable',
  'operation_failed',
]);

const MICROUSD_PER_USD = 1_000_000n;

export function parseAIBudgetUsdInput(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/u.exec(normalized);
  if (match === null) return null;
  const fractional = (match[2] ?? '').padEnd(6, '0');
  const microusd = (BigInt(match[1]) * MICROUSD_PER_USD) + BigInt(fractional || '0');
  if (microusd <= 0n || microusd > BigInt(AI_BUDGET_MAX_LIMIT_MICROUSD)) return null;
  return Number(microusd);
}

export function formatAIBudgetMicrousd(value) {
  if (!Number.isSafeInteger(value) || value < 0) return 'Tidak tersedia';
  const whole = Math.floor(value / 1_000_000);
  const fractional = String(value % 1_000_000).padStart(6, '0').replace(/0+$/u, '');
  return `US$${whole}${fractional.length > 0 ? `.${fractional}` : ''}`;
}

export class AIBudgetClientError extends Error {
  constructor(code) {
    super('Operasi budget AI tidak dapat diselesaikan.');
    this.name = 'AIBudgetClientError';
    this.code = SAFE_ERROR_CODES.has(code) ? code : 'operation_failed';
  }
}

function readEnvelope(envelope) {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new AIBudgetClientError('operation_failed');
  }
  if (envelope.ok !== true) throw new AIBudgetClientError(envelope.error?.code);
  if (!validateAIBudgetTransportResponse(envelope.response)) throw new AIBudgetClientError('operation_failed');
  return envelope.response;
}

export function createAIBudgetClient(options = {}) {
  const { statusTransport, mutationTransport = null } = options;
  if (typeof statusTransport !== 'function') throw new TypeError('Transport status budget AI tidak valid');
  if (mutationTransport !== null && typeof mutationTransport !== 'function') {
    throw new TypeError('Transport mutasi budget AI tidak valid');
  }

  async function execute(transport, request) {
    if (!validateAIBudgetTransportRequest(request)) throw new AIBudgetClientError('invalid_request');
    try {
      return readEnvelope(await transport(request));
    } catch (error) {
      if (error instanceof AIBudgetClientError) throw error;
      throw new AIBudgetClientError('operation_failed');
    }
  }

  return Object.freeze({
    canMutate: () => mutationTransport !== null,
    async getStatus() {
      const response = await execute(statusTransport, {
        schemaVersion: AI_BUDGET_TRANSPORT_VERSION,
        operation: AI_BUDGET_TRANSPORT_OPERATIONS.STATUS,
      });
      return response.status;
    },
    configure({ consentVersion, dailyLimitMicrousd, monthlyLimitMicrousd }) {
      if (mutationTransport === null) throw new AIBudgetClientError('mutation_disabled');
      return execute(mutationTransport, {
        schemaVersion: AI_BUDGET_TRANSPORT_VERSION,
        operation: AI_BUDGET_TRANSPORT_OPERATIONS.CONFIGURE,
        approved: true,
        consentVersion,
        dailyLimitMicrousd,
        monthlyLimitMicrousd,
      });
    },
  });
}

const electronApi = globalThis.window?.electronAPI;

export const aiBudgetClient = createAIBudgetClient({
  statusTransport: request => {
    if (typeof electronApi?.getAIBudgetStatus !== 'function') {
      throw new AIBudgetClientError('storage_unavailable');
    }
    return electronApi.getAIBudgetStatus(request);
  },
  mutationTransport: electronApi?.aiBudgetMutationsEnabled === true
    && typeof electronApi?.configureAIBudget === 'function'
    ? request => electronApi.configureAIBudget(request)
    : null,
});
