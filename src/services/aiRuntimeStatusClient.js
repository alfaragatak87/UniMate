import {
  AI_RUNTIME_STATUS_OPERATION,
  AI_RUNTIME_STATUS_VERSION,
} from '../../shared/ai/runtimeStatusContracts.mjs';
import {
  validateAIRuntimeStatusRequest,
  validateAIRuntimeStatusResponse,
} from '../../shared/ai/runtimeStatusValidation.mjs';

export class AIRuntimeStatusClientError extends Error {
  constructor() {
    super('Status runtime AI tidak tersedia.');
    this.name = 'AIRuntimeStatusClientError';
    this.code = 'runtime_status_unavailable';
  }
}

export function createAIRuntimeStatusClient(options = {}) {
  const { transport } = options;
  if (typeof transport !== 'function') throw new TypeError('Transport status runtime AI tidak valid');

  return Object.freeze({
    async getStatus() {
      const request = Object.freeze({
        schemaVersion: AI_RUNTIME_STATUS_VERSION,
        operation: AI_RUNTIME_STATUS_OPERATION,
      });
      if (!validateAIRuntimeStatusRequest(request)) throw new AIRuntimeStatusClientError();
      let envelope;
      try {
        envelope = await transport(request);
      } catch {
        throw new AIRuntimeStatusClientError();
      }
      if (
        envelope === null
        || typeof envelope !== 'object'
        || Array.isArray(envelope)
        || envelope.ok !== true
        || !validateAIRuntimeStatusResponse(envelope.response)
      ) {
        throw new AIRuntimeStatusClientError();
      }
      return envelope.response;
    },
  });
}

const electronApi = globalThis.window?.electronAPI;

export const aiRuntimeStatusClient = createAIRuntimeStatusClient({
  transport: request => {
    if (typeof electronApi?.getAIRuntimeStatus !== 'function') throw new AIRuntimeStatusClientError();
    return electronApi.getAIRuntimeStatus(request);
  },
});
