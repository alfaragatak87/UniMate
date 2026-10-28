import {
  AI_PROVIDER_ERROR_CODES,
  AI_PROVIDER_VALUES,
} from '../../../shared/ai/contracts.mjs';
import { getAIModel } from '../../../shared/ai/modelCatalog.mjs';
import {
  AIContractValidationError,
  assertValidAIRequest,
} from '../../../shared/ai/validation.mjs';

const PROVIDER_ERROR_VALUES = Object.freeze(Object.values(AI_PROVIDER_ERROR_CODES));

export class CredentialBackedProviderError extends Error {
  constructor(code) {
    super('Provider AI backend tidak dapat menyelesaikan permintaan.');
    this.name = 'CredentialBackedProviderError';
    this.code = PROVIDER_ERROR_VALUES.includes(code) ? code : AI_PROVIDER_ERROR_CODES.UNAVAILABLE;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeProviderErrorCode(error) {
  return PROVIDER_ERROR_VALUES.includes(error?.code)
    ? error.code
    : AI_PROVIDER_ERROR_CODES.UNAVAILABLE;
}

function mapCredentialError(error) {
  if (error?.code === 'invalid_request') {
    return new CredentialBackedProviderError(AI_PROVIDER_ERROR_CODES.INVALID_REQUEST);
  }
  if (error?.code === 'credential_missing') {
    return new CredentialBackedProviderError(AI_PROVIDER_ERROR_CODES.NOT_CONFIGURED);
  }
  if (error?.code === 'unsafe_result') {
    return new CredentialBackedProviderError(AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  }
  return new CredentialBackedProviderError(AI_PROVIDER_ERROR_CODES.UNAVAILABLE);
}

function isExecutionEnvelope(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (value.ok === true) return keys.length === 2 && keys.includes('ok') && keys.includes('value');
  if (value.ok === false) {
    return keys.length === 2
      && keys.includes('ok')
      && keys.includes('code')
      && PROVIDER_ERROR_VALUES.includes(value.code);
  }
  return false;
}

export function createCredentialBackedProvider(options = {}) {
  const { provider, modelId, credentialService, execute } = options;
  if (!AI_PROVIDER_VALUES.includes(provider)) throw new TypeError('Provider credential tidak didukung');
  if (getAIModel(modelId)?.provider !== provider) throw new TypeError('Model credential tidak didukung');
  if (typeof credentialService?.withCredential !== 'function') {
    throw new TypeError('Credential service provider tidak valid');
  }
  if (typeof execute !== 'function') throw new TypeError('Executor provider tidak valid');

  return Object.freeze({
    name: provider,
    modelId,

    async generate(request, options = {}) {
      try {
        assertValidAIRequest(request);
      } catch (error) {
        if (error instanceof AIContractValidationError) {
          throw new CredentialBackedProviderError(AI_PROVIDER_ERROR_CODES.INVALID_REQUEST);
        }
        throw new CredentialBackedProviderError(AI_PROVIDER_ERROR_CODES.UNAVAILABLE);
      }
      if (request.selection.provider !== provider || request.selection.modelId !== modelId) {
        throw new CredentialBackedProviderError(AI_PROVIDER_ERROR_CODES.INVALID_REQUEST);
      }

      let envelope;
      try {
        envelope = await credentialService.withCredential(provider, async credential => {
          try {
            const value = await execute(Object.freeze({
              request: clone(request),
              credential,
              signal: options.signal,
            }));
            return Object.freeze({ ok: true, value });
          } catch (error) {
            return Object.freeze({ ok: false, code: normalizeProviderErrorCode(error) });
          }
        });
      } catch (error) {
        throw mapCredentialError(error);
      }

      if (!isExecutionEnvelope(envelope)) {
        throw new CredentialBackedProviderError(AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE);
      }
      if (!envelope.ok) throw new CredentialBackedProviderError(envelope.code);
      return envelope.value;
    },
  });
}
