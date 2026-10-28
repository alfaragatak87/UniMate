import {
  AI_COMPLEXITY_LEVEL_VALUES,
  AI_SELECTION_MODE_VALUES,
} from './contracts.mjs';
import { isAIModelSelectable } from './modelCatalog.mjs';
import {
  AI_PREFERENCE_OPERATIONS,
  AI_PREFERENCE_STORAGE_STATES,
  AI_PREFERENCE_TRANSPORT_VERSION,
} from './preferenceTransportContracts.mjs';

export class AIPreferenceTransportValidationError extends Error {
  constructor() {
    super('Kontrak preferensi AI tidak valid.');
    this.name = 'AIPreferenceTransportValidationError';
    this.code = 'invalid_preference_transport';
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

export function validateAIPreferences(value) {
  return exactKeys(value, ['mode', 'complexity', 'modelId', 'preferFreeTier'])
    && AI_SELECTION_MODE_VALUES.includes(value.mode)
    && AI_COMPLEXITY_LEVEL_VALUES.includes(value.complexity)
    && isAIModelSelectable(value.modelId, 'chat')
    && value.preferFreeTier === true;
}

function validateQuotaStatus(value) {
  if (value === null) return true;
  return exactKeys(value, [
    'modelId', 'verifiedAt', 'realtime', 'periodTimezone', 'limits', 'locallyObserved',
  ])
    && typeof value.modelId === 'string'
    && typeof value.verifiedAt === 'string'
    && value.realtime === false
    && value.periodTimezone === 'America/Los_Angeles'
    && exactKeys(value.limits, ['requestsPerMinute', 'inputTokensPerMinute', 'requestsPerDay'])
    && Object.values(value.limits).every(item => Number.isSafeInteger(item) && item > 0)
    && exactKeys(value.locallyObserved, ['requestsThisMinute', 'inputTokensThisMinute', 'requestsToday'])
    && Object.values(value.locallyObserved).every(item => Number.isSafeInteger(item) && item >= 0);
}

export function validateAIPreferenceRequest(value) {
  if (!isPlainObject(value) || value.schemaVersion !== AI_PREFERENCE_TRANSPORT_VERSION) return false;
  if (value.operation === AI_PREFERENCE_OPERATIONS.STATUS) {
    return exactKeys(value, ['schemaVersion', 'operation']);
  }
  return value.operation === AI_PREFERENCE_OPERATIONS.UPDATE
    && exactKeys(value, ['schemaVersion', 'operation', 'preferences'])
    && validateAIPreferences(value.preferences);
}

export function validateAIPreferenceResponse(value) {
  if (!isPlainObject(value) || value.schemaVersion !== AI_PREFERENCE_TRANSPORT_VERSION) return false;
  if (value.operation === AI_PREFERENCE_OPERATIONS.UPDATE) {
    return exactKeys(value, ['schemaVersion', 'operation', 'changed']) && value.changed === true;
  }
  if (value.operation !== AI_PREFERENCE_OPERATIONS.STATUS) return false;
  return exactKeys(value, ['schemaVersion', 'operation', 'storage', 'preferences', 'policy', 'quota'])
    && AI_PREFERENCE_STORAGE_STATES.includes(value.storage)
    && validateAIPreferences(value.preferences)
    && exactKeys(value.policy, ['primaryProvider', 'openaiEnabled', 'automaticProviderFallback'])
    && value.policy.primaryProvider === 'gemini'
    && value.policy.openaiEnabled === false
    && value.policy.automaticProviderFallback === false
    && validateQuotaStatus(value.quota);
}

export function assertValidAIPreferenceRequest(value) {
  if (!validateAIPreferenceRequest(value)) throw new AIPreferenceTransportValidationError();
  return value;
}

export function assertValidAIPreferenceResponse(value) {
  if (!validateAIPreferenceResponse(value)) throw new AIPreferenceTransportValidationError();
  return value;
}
