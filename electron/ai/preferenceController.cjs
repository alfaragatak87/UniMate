const contractsModule = import('../../shared/ai/preferenceTransportContracts.mjs');
const validationModule = import('../../shared/ai/preferenceTransportValidation.mjs');

const ERROR_CODES = new Set(['invalid_request', 'storage_corrupt', 'storage_unavailable', 'operation_failed']);

class AIPreferenceControllerError extends Error {
  constructor(code) {
    super('Operasi preferensi AI tidak dapat diselesaikan.');
    this.name = 'AIPreferenceControllerError';
    this.code = ERROR_CODES.has(code) ? code : 'operation_failed';
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createAIPreferenceController(options = {}) {
  const { store, quotaGuard = null, now = Date.now } = options;
  if (typeof store?.read !== 'function' || typeof store?.write !== 'function' || typeof now !== 'function') {
    throw new TypeError('Controller preferensi AI tidak valid');
  }
  let mutationQueue = Promise.resolve();

  function serializeMutation(operation) {
    const pending = mutationQueue.then(operation, operation);
    mutationQueue = pending.catch(() => undefined);
    return pending;
  }

  async function readStoredPreferences() {
    const [contracts, validation] = await Promise.all([contractsModule, validationModule]);
    let result;
    try {
      result = await store.read();
    } catch {
      throw new AIPreferenceControllerError('storage_unavailable');
    }
    if (result?.status === 'missing') {
      return { storage: 'missing', preferences: contracts.AI_DEFAULT_PREFERENCES };
    }
    if (result?.status !== 'ready') {
      return { storage: 'corrupt', preferences: contracts.AI_DEFAULT_PREFERENCES };
    }
    const state = result.state;
    if (
      state?.schemaVersion !== contracts.AI_PREFERENCE_TRANSPORT_VERSION
      || !Number.isSafeInteger(state.updatedAt)
      || state.updatedAt < 1
      || !validation.validateAIPreferences(state.preferences)
      || Object.keys(state).length !== 3
    ) {
      return { storage: 'corrupt', preferences: contracts.AI_DEFAULT_PREFERENCES };
    }
    return { storage: 'ready', preferences: Object.freeze(clone(state.preferences)) };
  }

  async function statusResponse() {
    const [contracts, validation, stored] = await Promise.all([
      contractsModule,
      validationModule,
      readStoredPreferences(),
    ]);
    let quota = null;
    try {
      quota = typeof quotaGuard?.getStatus === 'function'
        ? await quotaGuard.getStatus(stored.preferences.modelId)
        : null;
    } catch {}
    const response = Object.freeze({
      schemaVersion: contracts.AI_PREFERENCE_TRANSPORT_VERSION,
      operation: contracts.AI_PREFERENCE_OPERATIONS.STATUS,
      storage: stored.storage,
      preferences: stored.preferences,
      policy: Object.freeze({
        primaryProvider: 'gemini',
        openaiEnabled: false,
        automaticProviderFallback: false,
      }),
      quota,
    });
    try {
      validation.assertValidAIPreferenceResponse(response);
    } catch {
      throw new AIPreferenceControllerError('operation_failed');
    }
    return response;
  }

  async function update(request) {
    const [contracts, validation, stored] = await Promise.all([
      contractsModule,
      validationModule,
      readStoredPreferences(),
    ]);
    if (stored.storage === 'corrupt') throw new AIPreferenceControllerError('storage_corrupt');
    const state = {
      schemaVersion: contracts.AI_PREFERENCE_TRANSPORT_VERSION,
      updatedAt: now(),
      preferences: clone(request.preferences),
    };
    if (!validation.validateAIPreferences(state.preferences) || !Number.isSafeInteger(state.updatedAt) || state.updatedAt < 1) {
      throw new AIPreferenceControllerError('invalid_request');
    }
    try {
      await store.write(state);
    } catch {
      throw new AIPreferenceControllerError('storage_unavailable');
    }
    return Object.freeze({
      schemaVersion: contracts.AI_PREFERENCE_TRANSPORT_VERSION,
      operation: contracts.AI_PREFERENCE_OPERATIONS.UPDATE,
      changed: true,
    });
  }

  return Object.freeze({
    async execute(request) {
      const [contracts, validation] = await Promise.all([contractsModule, validationModule]);
      try {
        validation.assertValidAIPreferenceRequest(request);
      } catch {
        throw new AIPreferenceControllerError('invalid_request');
      }
      if (request.operation === contracts.AI_PREFERENCE_OPERATIONS.STATUS) return statusResponse();
      return serializeMutation(() => update(request));
    },
  });
}

module.exports = { AIPreferenceControllerError, createAIPreferenceController };
