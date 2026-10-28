import {
  AI_CAPABILITY_VALUES,
  AI_PROVIDER_ERROR_CODES,
  AI_PROVIDER_VALUES,
} from '../../../shared/ai/contracts.mjs';
import {
  AI_DEFAULT_MODEL_ID,
  getAIModel,
} from '../../../shared/ai/modelCatalog.mjs';
import {
  AIContractValidationError,
  assertValidAIRequest,
  validateCapabilityResult,
} from '../../../shared/ai/validation.mjs';

export const MOCK_PROVIDER_SCENARIOS = Object.freeze({
  SUCCESS: 'success',
  TIMEOUT: 'timeout',
  RATE_LIMITED: 'rate_limited',
  CANCELLED: 'cancelled',
  UNAVAILABLE: 'unavailable',
  INVALID_RESPONSE: 'invalid_response',
});

const MOCK_SCENARIO_VALUES = Object.freeze(Object.values(MOCK_PROVIDER_SCENARIOS));

export class MockProviderError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'MockProviderError';
    this.code = code;
    this.retryable = options.retryable === true;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateOptions(provider, modelId, scenario, responses) {
  if (!AI_PROVIDER_VALUES.includes(provider)) throw new TypeError(`Provider mock tidak didukung: ${provider}`);
  if (getAIModel(modelId)?.provider !== provider) throw new TypeError(`Model mock tidak didukung: ${modelId}`);
  if (!MOCK_SCENARIO_VALUES.includes(scenario)) throw new TypeError(`Skenario mock tidak didukung: ${scenario}`);
  if (responses === null || typeof responses !== 'object' || Array.isArray(responses)) {
    throw new TypeError('responses harus berupa object');
  }
}

export function createMockProvider(options = {}) {
  const {
    provider = 'gemini',
    modelId = AI_DEFAULT_MODEL_ID,
    scenario = MOCK_PROVIDER_SCENARIOS.SUCCESS,
    responses = {},
  } = options;

  validateOptions(provider, modelId, scenario, responses);
  const calls = [];

  return Object.freeze({
    name: provider,
    modelId,

    async generate(request) {
      try {
        assertValidAIRequest(request);
      } catch (error) {
        if (error instanceof AIContractValidationError) {
          throw new MockProviderError(AI_PROVIDER_ERROR_CODES.INVALID_REQUEST, 'Request mock tidak valid');
        }
        throw error;
      }

      calls.push(clone(request));

      if (scenario === MOCK_PROVIDER_SCENARIOS.TIMEOUT) {
        throw new MockProviderError(AI_PROVIDER_ERROR_CODES.TIMEOUT, 'Simulasi timeout provider', { retryable: true });
      }
      if (scenario === MOCK_PROVIDER_SCENARIOS.RATE_LIMITED) {
        throw new MockProviderError(AI_PROVIDER_ERROR_CODES.RATE_LIMITED, 'Simulasi rate limit provider', { retryable: true });
      }
      if (scenario === MOCK_PROVIDER_SCENARIOS.CANCELLED) {
        throw new MockProviderError(AI_PROVIDER_ERROR_CODES.CANCELLED, 'Simulasi pembatalan provider');
      }
      if (scenario === MOCK_PROVIDER_SCENARIOS.UNAVAILABLE) {
        throw new MockProviderError(AI_PROVIDER_ERROR_CODES.UNAVAILABLE, 'Simulasi provider tidak tersedia', { retryable: true });
      }
      if (scenario === MOCK_PROVIDER_SCENARIOS.INVALID_RESPONSE) {
        return { invalid: true };
      }

      if (!AI_CAPABILITY_VALUES.includes(request.capability) || !Object.hasOwn(responses, request.capability)) {
        throw new MockProviderError(AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE, 'Fixture respons mock tidak tersedia');
      }

      const result = clone(responses[request.capability]);
      const validation = validateCapabilityResult(request.capability, result);
      if (!validation.valid) {
        throw new MockProviderError(AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE, 'Fixture respons mock tidak valid');
      }

      return {
        provider,
        modelId,
        result,
      };
    },

    getCallCount() {
      return calls.length;
    },

    getCalls() {
      return clone(calls);
    },

    reset() {
      calls.length = 0;
    },
  });
}
