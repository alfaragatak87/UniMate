import {
  AI_DEFAULT_MODEL_ID,
  AI_MODEL_AVAILABILITY,
  AI_MODEL_CATALOG,
  AI_MODEL_CATALOG_VERSION,
  AI_MODEL_PRICING_VERIFIED_AT,
} from './modelCatalog.mjs';

export const AI_RUNTIME_STATUS_VERSION = 2;
export const AI_RUNTIME_STATUS_OPERATION = 'status';
export const AI_RUNTIME_TARGET = 'electron_packaged_windows';
export const AI_RUNTIME_PROFILE_SCOPE = 'same_electron_profile';

export const AI_GATEWAY_STATUS_STATES = Object.freeze([
  'disabled',
  'idle',
  'starting',
  'running',
  'unavailable',
  'stopped',
]);

export const AI_RUNTIME_MODEL_STATUS = Object.freeze({
  catalogVersion: AI_MODEL_CATALOG_VERSION,
  verifiedAt: AI_MODEL_PRICING_VERIFIED_AT,
  defaultModelId: AI_DEFAULT_MODEL_ID,
  available: Object.freeze(Object.values(AI_MODEL_CATALOG)
    .filter(model => model.availability === AI_MODEL_AVAILABILITY.AVAILABLE)
    .map(model => model.modelId)),
  partiallyVerified: Object.freeze(Object.values(AI_MODEL_CATALOG)
    .filter(model => model.availability === AI_MODEL_AVAILABILITY.PARTIALLY_VERIFIED)
    .map(model => model.modelId)),
  openaiEnabled: false,
});
