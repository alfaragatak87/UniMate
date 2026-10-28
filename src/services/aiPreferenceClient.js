import {
  AI_DEFAULT_PREFERENCES,
  AI_PREFERENCE_OPERATIONS,
  AI_PREFERENCE_TRANSPORT_VERSION,
} from '../../shared/ai/preferenceTransportContracts.mjs';
import {
  validateAIPreferenceRequest,
  validateAIPreferenceResponse,
  validateAIPreferences,
} from '../../shared/ai/preferenceTransportValidation.mjs';

const SAFE_ERROR_CODES = new Set([
  'invalid_request',
  'ipc_sender_rejected',
  'storage_corrupt',
  'storage_unavailable',
  'operation_failed',
]);

export class AIPreferenceClientError extends Error {
  constructor(code) {
    super('Preferensi AI tidak dapat diproses.');
    this.name = 'AIPreferenceClientError';
    this.code = SAFE_ERROR_CODES.has(code) ? code : 'operation_failed';
  }
}

function readEnvelope(envelope) {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new AIPreferenceClientError('operation_failed');
  }
  if (envelope.ok !== true) throw new AIPreferenceClientError(envelope.error?.code);
  if (!validateAIPreferenceResponse(envelope.response)) throw new AIPreferenceClientError('operation_failed');
  return envelope.response;
}

export function createAIPreferenceClient(options = {}) {
  const { statusTransport, updateTransport } = options;
  if (typeof statusTransport !== 'function' || typeof updateTransport !== 'function') {
    throw new TypeError('Transport preferensi AI tidak valid');
  }

  async function execute(transport, request) {
    if (!validateAIPreferenceRequest(request)) throw new AIPreferenceClientError('invalid_request');
    try {
      return readEnvelope(await transport(request));
    } catch (error) {
      if (error instanceof AIPreferenceClientError) throw error;
      throw new AIPreferenceClientError('operation_failed');
    }
  }

  return Object.freeze({
    async getStatus() {
      return execute(statusTransport, {
        schemaVersion: AI_PREFERENCE_TRANSPORT_VERSION,
        operation: AI_PREFERENCE_OPERATIONS.STATUS,
      });
    },
    async update(preferences) {
      if (!validateAIPreferences(preferences)) throw new AIPreferenceClientError('invalid_request');
      return execute(updateTransport, {
        schemaVersion: AI_PREFERENCE_TRANSPORT_VERSION,
        operation: AI_PREFERENCE_OPERATIONS.UPDATE,
        preferences,
      });
    },
    defaults: AI_DEFAULT_PREFERENCES,
  });
}

const electronApi = globalThis.window?.electronAPI;

export const aiPreferenceClient = createAIPreferenceClient({
  statusTransport: request => {
    if (typeof electronApi?.getAIPreferenceStatus !== 'function') {
      throw new AIPreferenceClientError('storage_unavailable');
    }
    return electronApi.getAIPreferenceStatus(request);
  },
  updateTransport: request => {
    if (typeof electronApi?.updateAIPreferences !== 'function') {
      throw new AIPreferenceClientError('storage_unavailable');
    }
    return electronApi.updateAIPreferences(request);
  },
});
