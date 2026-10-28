import {
  AI_CAPABILITIES,
  AI_OUTPUT_TOKEN_LIMITS,
} from '../../shared/ai/contracts.mjs';
import {
  AI_MODEL_CATALOG_VERSION,
  getAIModel,
} from '../../shared/ai/modelCatalog.mjs';
import { assertValidAIRequest } from '../../shared/ai/validation.mjs';

const BUDGET_SCHEMA_VERSION = 1;
const MAX_LEDGER_ENTRIES = 10_000;
const MAX_LIMIT_MICROUSD = 1_000_000_000;
const TEXT_PROMPT_OVERHEAD_TOKENS = 2048;
const ENTRY_STATUS = Object.freeze({ RESERVED: 'reserved', SETTLED: 'settled' });

export class AIBudgetGuardError extends Error {
  constructor(code) {
    super('Budget AI tidak mengizinkan permintaan.');
    this.name = 'AIBudgetGuardError';
    this.code = [
      'budget_not_configured',
      'budget_exceeded',
      'budget_unavailable',
      'request_cancelled',
    ].includes(code) ? code : 'budget_unavailable';
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
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_LIMIT_MICROUSD;
}

function validatePolicy(policy) {
  if (!exactKeys(policy, [
    'approved', 'consentVersion', 'dailyLimitMicrousd', 'monthlyLimitMicrousd', 'configuredAt',
  ])) return false;
  return policy.approved === true
    && Number.isSafeInteger(policy.consentVersion)
    && policy.consentVersion > 0
    && validLimit(policy.dailyLimitMicrousd)
    && validLimit(policy.monthlyLimitMicrousd)
    && policy.dailyLimitMicrousd <= policy.monthlyLimitMicrousd
    && Number.isSafeInteger(policy.configuredAt)
    && policy.configuredAt > 0;
}

function validateEstimate(value) {
  return exactKeys(value, ['provider', 'modelId', 'inputTokens', 'outputTokens', 'microusd'])
    && getAIModel(value.modelId)?.provider === value.provider
    && Number.isSafeInteger(value.inputTokens)
    && value.inputTokens > 0
    && Number.isSafeInteger(value.outputTokens)
    && value.outputTokens > 0
    && Number.isSafeInteger(value.microusd)
    && value.microusd > 0;
}

function validateEntry(entry) {
  if (!exactKeys(entry, [
    'requestId', 'createdAt', 'dayKey', 'monthKey', 'status', 'estimates',
    'reservedMicrousd', 'settledMicrousd', 'outcome',
  ])) return false;
  return typeof entry.requestId === 'string'
    && Number.isSafeInteger(entry.createdAt)
    && /^\d{4}-\d{2}-\d{2}$/u.test(entry.dayKey)
    && /^\d{4}-\d{2}$/u.test(entry.monthKey)
    && Object.values(ENTRY_STATUS).includes(entry.status)
    && Array.isArray(entry.estimates)
    && entry.estimates.length >= 1
    && entry.estimates.length <= 2
    && entry.estimates.every(validateEstimate)
    && Number.isSafeInteger(entry.reservedMicrousd)
    && entry.reservedMicrousd > 0
    && (entry.settledMicrousd === null || (Number.isSafeInteger(entry.settledMicrousd) && entry.settledMicrousd > 0))
    && (entry.outcome === null || ['success', 'failed', 'cancelled'].includes(entry.outcome));
}

function validateState(state) {
  if (!exactKeys(state, ['schemaVersion', 'modelCatalogVersion', 'policy', 'entries'])) return false;
  return state.schemaVersion === BUDGET_SCHEMA_VERSION
    && state.modelCatalogVersion === AI_MODEL_CATALOG_VERSION
    && (state.policy === null || validatePolicy(state.policy))
    && Array.isArray(state.entries)
    && state.entries.length <= MAX_LEDGER_ENTRIES
    && state.entries.every(validateEntry)
    && new Set(state.entries.map(entry => entry.requestId)).size === state.entries.length;
}

function periodKeys(timestamp) {
  const iso = new Date(timestamp).toISOString();
  return Object.freeze({ dayKey: iso.slice(0, 10), monthKey: iso.slice(0, 7) });
}

function estimateInputTokens(request, model) {
  if (request.capability === AI_CAPABILITIES.DOCUMENT_SCAN) {
    return Math.min(model.contextWindowTokens, TEXT_PROMPT_OVERHEAD_TOKENS + Math.ceil(request.input.file.size / 2));
  }
  const bytes = Buffer.byteLength(JSON.stringify(request.input), 'utf8');
  return Math.min(model.contextWindowTokens, TEXT_PROMPT_OVERHEAD_TOKENS + Math.ceil(bytes / 2));
}

function estimateProvider(request, modelId) {
  const model = getAIModel(modelId);
  if (model === null) throw new AIBudgetGuardError('budget_unavailable');
  const provider = model.provider;
  if (!model.capabilities.includes(request.capability)) throw new AIBudgetGuardError('budget_unavailable');
  const inputTokens = estimateInputTokens(request, model);
  const outputTokens = AI_OUTPUT_TOKEN_LIMITS[request.capability];
  const longContext = model.longContextThresholdTokens !== null
    && inputTokens > model.longContextThresholdTokens;
  const inputRate = longContext
    ? model.pricingMicrousdPerMillionTokens.longInput
    : model.pricingMicrousdPerMillionTokens.input;
  const outputRate = longContext
    ? model.pricingMicrousdPerMillionTokens.longOutput
    : model.pricingMicrousdPerMillionTokens.output;
  const microusd = Math.ceil((inputTokens * inputRate) / 1_000_000)
    + Math.ceil((outputTokens * outputRate) / 1_000_000);
  return Object.freeze({ provider, modelId: model.modelId, inputTokens, outputTokens, microusd });
}

export function estimateAIBudget(request) {
  assertValidAIRequest(request);
  return Object.freeze([estimateProvider(request, request.selection.modelId)]);
}

function activeAmount(entry) {
  return entry.status === ENTRY_STATUS.SETTLED ? entry.settledMicrousd : entry.reservedMicrousd;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createAIBudgetGuard(options = {}) {
  const { store, now = Date.now } = options;
  if (typeof store?.read !== 'function' || typeof store?.write !== 'function') {
    throw new TypeError('Store budget AI tidak valid');
  }
  if (typeof now !== 'function') throw new TypeError('Clock budget AI tidak valid');
  let mutationQueue = Promise.resolve();

  function enqueue(operation) {
    const pending = mutationQueue.then(operation, operation);
    mutationQueue = pending.catch(() => {});
    return pending;
  }

  async function readState() {
    let result;
    try {
      result = await store.read();
    } catch {
      throw new AIBudgetGuardError('budget_unavailable');
    }
    if (result?.status === 'missing') {
      return { schemaVersion: BUDGET_SCHEMA_VERSION, modelCatalogVersion: AI_MODEL_CATALOG_VERSION, policy: null, entries: [] };
    }
    if (result?.status !== 'ready' || !validateState(result.state)) {
      throw new AIBudgetGuardError('budget_unavailable');
    }
    return clone(result.state);
  }

  async function writeState(state) {
    if (!validateState(state)) throw new AIBudgetGuardError('budget_unavailable');
    try {
      await store.write(state);
    } catch {
      throw new AIBudgetGuardError('budget_unavailable');
    }
  }

  return Object.freeze({
    configurePolicy(input) {
      return enqueue(async () => {
        if (!exactKeys(input, ['schemaVersion', 'approved', 'consentVersion', 'dailyLimitMicrousd', 'monthlyLimitMicrousd'])
          || input.schemaVersion !== BUDGET_SCHEMA_VERSION
          || input.approved !== true
          || !Number.isSafeInteger(input.consentVersion)
          || input.consentVersion < 1
          || !validLimit(input.dailyLimitMicrousd)
          || !validLimit(input.monthlyLimitMicrousd)
          || input.dailyLimitMicrousd > input.monthlyLimitMicrousd) {
          throw new AIBudgetGuardError('budget_not_configured');
        }
        const state = await readState();
        state.policy = {
          approved: true,
          consentVersion: input.consentVersion,
          dailyLimitMicrousd: input.dailyLimitMicrousd,
          monthlyLimitMicrousd: input.monthlyLimitMicrousd,
          configuredAt: now(),
        };
        await writeState(state);
        return Object.freeze({ configured: true, consentVersion: input.consentVersion });
      });
    },

    getStatus() {
      return enqueue(async () => {
        const state = await readState();
        const timestamp = now();
        const keys = periodKeys(timestamp);
        const dailyUsedMicrousd = state.entries
          .filter(entry => entry.dayKey === keys.dayKey)
          .reduce((sum, entry) => sum + activeAmount(entry), 0);
        const monthlyUsedMicrousd = state.entries
          .filter(entry => entry.monthKey === keys.monthKey)
          .reduce((sum, entry) => sum + activeAmount(entry), 0);
        return Object.freeze({
          configured: state.policy !== null,
          approved: state.policy?.approved === true,
          dailyLimitMicrousd: state.policy?.dailyLimitMicrousd ?? null,
          monthlyLimitMicrousd: state.policy?.monthlyLimitMicrousd ?? null,
          dailyUsedMicrousd,
          monthlyUsedMicrousd,
          pendingReservations: state.entries.filter(entry => entry.status === ENTRY_STATUS.RESERVED).length,
          periodTimezone: 'UTC',
        });
      });
    },

    reserve(request, options = {}) {
      return enqueue(async () => {
        assertValidAIRequest(request);
        if (options.signal?.aborted) throw new AIBudgetGuardError('request_cancelled');
        const state = await readState();
        if (state.policy?.approved !== true) throw new AIBudgetGuardError('budget_not_configured');
        if (state.entries.length >= MAX_LEDGER_ENTRIES) throw new AIBudgetGuardError('budget_unavailable');
        if (state.entries.some(entry => entry.requestId === request.requestId)) {
          throw new AIBudgetGuardError('budget_unavailable');
        }
        const timestamp = now();
        const keys = periodKeys(timestamp);
        const estimates = estimateAIBudget(request);
        const reservedMicrousd = estimates.reduce((sum, estimate) => sum + estimate.microusd, 0);
        const dailyUsed = state.entries
          .filter(entry => entry.dayKey === keys.dayKey)
          .reduce((sum, entry) => sum + activeAmount(entry), 0);
        const monthlyUsed = state.entries
          .filter(entry => entry.monthKey === keys.monthKey)
          .reduce((sum, entry) => sum + activeAmount(entry), 0);
        if (
          dailyUsed + reservedMicrousd > state.policy.dailyLimitMicrousd
          || monthlyUsed + reservedMicrousd > state.policy.monthlyLimitMicrousd
        ) {
          throw new AIBudgetGuardError('budget_exceeded');
        }
        state.entries.push({
          requestId: request.requestId,
          createdAt: timestamp,
          ...keys,
          status: ENTRY_STATUS.RESERVED,
          estimates: clone(estimates),
          reservedMicrousd,
          settledMicrousd: null,
          outcome: null,
        });
        await writeState(state);
        return Object.freeze({ requestId: request.requestId });
      });
    },

    settle(reservation, response) {
      return enqueue(async () => {
        const state = await readState();
        const entry = state.entries.find(candidate => candidate.requestId === reservation?.requestId);
        if (!entry || entry.status !== ENTRY_STATUS.RESERVED) throw new AIBudgetGuardError('budget_unavailable');
        let attemptCount = 1;
        let outcome = 'failed';
        if (response?.success === true) {
          attemptCount = response.meta?.attemptCount;
          outcome = 'success';
        } else if (response?.error?.code === 'request_cancelled') {
          outcome = 'cancelled';
        }
        if (!Number.isInteger(attemptCount) || attemptCount < 1 || attemptCount > entry.estimates.length) {
          throw new AIBudgetGuardError('budget_unavailable');
        }
        entry.status = ENTRY_STATUS.SETTLED;
        entry.settledMicrousd = entry.estimates
          .slice(0, attemptCount)
          .reduce((sum, estimate) => sum + estimate.microusd, 0);
        entry.outcome = outcome;
        await writeState(state);
        return Object.freeze({ settled: true });
      });
    },

    markUnknown(reservation) {
      return enqueue(async () => {
        const state = await readState();
        const entry = state.entries.find(candidate => candidate.requestId === reservation?.requestId);
        if (!entry || entry.status !== ENTRY_STATUS.RESERVED) throw new AIBudgetGuardError('budget_unavailable');
        return Object.freeze({ retained: true });
      });
    },
  });
}

export const AI_BUDGET_SCHEMA_VERSION = BUDGET_SCHEMA_VERSION;
