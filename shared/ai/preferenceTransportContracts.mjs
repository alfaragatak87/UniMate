import {
  AI_COMPLEXITY_LEVELS,
  AI_SELECTION_MODES,
} from './contracts.mjs';
import { AI_DEFAULT_MODEL_ID } from './modelCatalog.mjs';

export const AI_PREFERENCE_TRANSPORT_VERSION = 1;

export const AI_PREFERENCE_OPERATIONS = Object.freeze({
  STATUS: 'status',
  UPDATE: 'update',
});

export const AI_PREFERENCE_STORAGE_STATES = Object.freeze([
  'missing',
  'ready',
  'corrupt',
]);

export const AI_DEFAULT_PREFERENCES = Object.freeze({
  mode: AI_SELECTION_MODES.AUTOMATIC,
  complexity: AI_COMPLEXITY_LEVELS.MEDIUM,
  modelId: AI_DEFAULT_MODEL_ID,
  preferFreeTier: true,
});
