import {
  AI_ACCESS_MODES,
  AI_CAPABILITIES,
  AI_OUTPUT_TOKEN_LIMITS,
} from '../../shared/ai/contracts.mjs';
import {
  AI_MODEL_CATALOG_VERSION,
  getAIModel,
} from '../../shared/ai/modelCatalog.mjs';
import {
  AI_FREE_TIER_QUOTA_ENTRY_STATUS,
  AI_FREE_TIER_QUOTA_MAX_ENTRIES,
  AI_FREE_TIER_QUOTA_OUTCOMES,
  AI_FREE_TIER_QUOTA_SCHEMA_VERSION,
  AI_FREE_TIER_QUOTA_TIMEZONE,
} from '../../shared/ai/freeTierQuotaContracts.mjs';
import { assertValidAIRequest } from '../../shared/ai/validation.mjs';

const MINUTE_MS = 60_000;
const RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

export class AIFreeTierQuotaError extends Error {
  constructor(code) {
    super('Kuota Gemini Free Tier tidak mengizinkan permintaan.');
    this.name = 'AIFreeTierQuotaError';
    this.code = ['quota_exceeded', 'quota_unavailable', 'request_cancelled'].includes(code)
      ? code
      : 'quota_unavailable';
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

function pacificDayKey(timestamp) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: AI_FREE_TIER_QUOTA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validateEntry(entry) {
  return exactKeys(entry, [
    'requestId', 'modelId', 'createdAt', 'dayKey', 'inputTokens',
    'outputTokenLimit', 'status', 'outcome',
  ])
    && typeof entry.requestId === 'string'
    && getAIModel(entry.modelId)?.selectable === true
    && Number.isSafeInteger(entry.createdAt)
    && entry.createdAt > 0
    && /^\d{4}-\d{2}-\d{2}$/u.test(entry.dayKey)
    && Number.isSafeInteger(entry.inputTokens)
    && entry.inputTokens > 0
    && Number.isSafeInteger(entry.outputTokenLimit)
    && entry.outputTokenLimit > 0
    && Object.values(AI_FREE_TIER_QUOTA_ENTRY_STATUS).includes(entry.status)
    && (entry.outcome === null || AI_FREE_TIER_QUOTA_OUTCOMES.includes(entry.outcome));
}

function validateState(state) {
  return exactKeys(state, ['schemaVersion', 'modelCatalogVersion', 'entries'])
    && state.schemaVersion === AI_FREE_TIER_QUOTA_SCHEMA_VERSION
    && state.modelCatalogVersion === AI_MODEL_CATALOG_VERSION
    && Array.isArray(state.entries)
    && state.entries.length <= AI_FREE_TIER_QUOTA_MAX_ENTRIES
    && state.entries.every(validateEntry)
    && new Set(state.entries.map(entry => entry.requestId)).size === state.entries.length;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function estimateFreeTierInputTokens(request) {
  assertValidAIRequest(request);
  const model = getAIModel(request.selection.modelId);
  if (model?.selectable !== true) throw new AIFreeTierQuotaError('quota_unavailable');
  const inputTokens = request.capability === AI_CAPABILITIES.DOCUMENT_SCAN
    ? 2_048 + Math.ceil(request.input.file.size / 2)
    : 512 + Math.ceil(Buffer.byteLength(JSON.stringify(request.input), 'utf8') / 2);
  return Math.min(model.contextWindowTokens, Math.max(1, inputTokens));
}

export function createAIFreeTierQuotaGuard(options = {}) {
  const { store, now = Date.now } = options;
  if (typeof store?.read !== 'function' || typeof store?.write !== 'function') {
    throw new TypeError('Store kuota Free Tier tidak valid');
  }
  if (typeof now !== 'function') throw new TypeError('Clock kuota Free Tier tidak valid');
  let mutationQueue = Promise.resolve();

  function enqueue(operation) {
    const pending = mutationQueue.then(operation, operation);
    mutationQueue = pending.catch(() => undefined);
    return pending;
  }

  async function readState() {
    let result;
    try {
      result = await store.read();
    } catch {
      throw new AIFreeTierQuotaError('quota_unavailable');
    }
    if (result?.status === 'missing') {
      return {
        schemaVersion: AI_FREE_TIER_QUOTA_SCHEMA_VERSION,
        modelCatalogVersion: AI_MODEL_CATALOG_VERSION,
        entries: [],
      };
    }
    if (result?.status !== 'ready' || !validateState(result.state)) {
      throw new AIFreeTierQuotaError('quota_unavailable');
    }
    return clone(result.state);
  }

  async function writeState(state) {
    if (!validateState(state)) throw new AIFreeTierQuotaError('quota_unavailable');
    try {
      await store.write(state);
    } catch {
      throw new AIFreeTierQuotaError('quota_unavailable');
    }
  }

  function requireQuota(modelId) {
    const model = getAIModel(modelId);
    const quota = model?.quota;
    if (
      model?.selectable !== true
      || model.accessMode !== AI_ACCESS_MODES.FREE_ONLY
      || !Number.isSafeInteger(quota?.requestsPerMinute)
      || !Number.isSafeInteger(quota?.inputTokensPerMinute)
      || !Number.isSafeInteger(quota?.requestsPerDay)
      || typeof quota.verifiedAt !== 'string'
    ) {
      throw new AIFreeTierQuotaError('quota_unavailable');
    }
    return quota;
  }

  function prune(state, timestamp) {
    state.entries = state.entries.filter(entry => entry.createdAt >= timestamp - RETENTION_MS);
  }

  return Object.freeze({
    getStatus(modelId) {
      return enqueue(async () => {
        const quota = requireQuota(modelId);
        const state = await readState();
        const timestamp = now();
        const dayKey = pacificDayKey(timestamp);
        const minuteEntries = state.entries.filter(entry => (
          entry.modelId === modelId && entry.createdAt > timestamp - MINUTE_MS
        ));
        const dayEntries = state.entries.filter(entry => entry.modelId === modelId && entry.dayKey === dayKey);
        return Object.freeze({
          modelId,
          verifiedAt: quota.verifiedAt,
          realtime: false,
          periodTimezone: AI_FREE_TIER_QUOTA_TIMEZONE,
          limits: Object.freeze({
            requestsPerMinute: quota.requestsPerMinute,
            inputTokensPerMinute: quota.inputTokensPerMinute,
            requestsPerDay: quota.requestsPerDay,
          }),
          locallyObserved: Object.freeze({
            requestsThisMinute: minuteEntries.length,
            inputTokensThisMinute: minuteEntries.reduce((sum, entry) => sum + entry.inputTokens, 0),
            requestsToday: dayEntries.length,
          }),
        });
      });
    },

    reserve(request, optionsValue = {}) {
      return enqueue(async () => {
        assertValidAIRequest(request);
        if (optionsValue.signal?.aborted) throw new AIFreeTierQuotaError('request_cancelled');
        if (request.selection.accessMode !== AI_ACCESS_MODES.FREE_ONLY) {
          throw new AIFreeTierQuotaError('quota_unavailable');
        }
        const quota = requireQuota(request.selection.modelId);
        const state = await readState();
        const timestamp = now();
        prune(state, timestamp);
        if (state.entries.length >= AI_FREE_TIER_QUOTA_MAX_ENTRIES) {
          throw new AIFreeTierQuotaError('quota_unavailable');
        }
        if (state.entries.some(entry => entry.requestId === request.requestId)) {
          throw new AIFreeTierQuotaError('quota_unavailable');
        }
        const dayKey = pacificDayKey(timestamp);
        const inputTokens = estimateFreeTierInputTokens(request);
        const minuteEntries = state.entries.filter(entry => (
          entry.modelId === request.selection.modelId && entry.createdAt > timestamp - MINUTE_MS
        ));
        const requestsToday = state.entries.filter(entry => (
          entry.modelId === request.selection.modelId && entry.dayKey === dayKey
        )).length;
        const inputTokensThisMinute = minuteEntries.reduce((sum, entry) => sum + entry.inputTokens, 0);
        if (
          minuteEntries.length + 1 > quota.requestsPerMinute
          || inputTokensThisMinute + inputTokens > quota.inputTokensPerMinute
          || requestsToday + 1 > quota.requestsPerDay
        ) {
          throw new AIFreeTierQuotaError('quota_exceeded');
        }
        state.entries.push({
          requestId: request.requestId,
          modelId: request.selection.modelId,
          createdAt: timestamp,
          dayKey,
          inputTokens,
          outputTokenLimit: AI_OUTPUT_TOKEN_LIMITS[request.capability],
          status: AI_FREE_TIER_QUOTA_ENTRY_STATUS.RESERVED,
          outcome: null,
        });
        await writeState(state);
        return Object.freeze({ requestId: request.requestId, modelId: request.selection.modelId });
      });
    },

    settle(reservation, response) {
      return enqueue(async () => {
        const state = await readState();
        const entry = state.entries.find(candidate => candidate.requestId === reservation?.requestId);
        if (!entry || entry.status !== AI_FREE_TIER_QUOTA_ENTRY_STATUS.RESERVED) {
          throw new AIFreeTierQuotaError('quota_unavailable');
        }
        entry.status = AI_FREE_TIER_QUOTA_ENTRY_STATUS.SETTLED;
        entry.outcome = response?.success === true
          ? 'success'
          : response?.error?.code === 'request_cancelled' ? 'cancelled' : 'failed';
        await writeState(state);
        return Object.freeze({ settled: true });
      });
    },

    markUnknown(reservation) {
      return enqueue(async () => {
        const state = await readState();
        const entry = state.entries.find(candidate => candidate.requestId === reservation?.requestId);
        if (!entry || entry.status !== AI_FREE_TIER_QUOTA_ENTRY_STATUS.RESERVED) {
          throw new AIFreeTierQuotaError('quota_unavailable');
        }
        entry.status = AI_FREE_TIER_QUOTA_ENTRY_STATUS.SETTLED;
        entry.outcome = 'unknown';
        await writeState(state);
        return Object.freeze({ retained: true });
      });
    },
  });
}
