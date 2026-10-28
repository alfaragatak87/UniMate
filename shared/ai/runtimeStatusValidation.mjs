import {
  AI_GATEWAY_STATUS_STATES,
  AI_RUNTIME_MODEL_STATUS,
  AI_RUNTIME_PROFILE_SCOPE,
  AI_RUNTIME_STATUS_OPERATION,
  AI_RUNTIME_STATUS_VERSION,
  AI_RUNTIME_TARGET,
} from './runtimeStatusContracts.mjs';

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

export function validateAIRuntimeStatusRequest(value) {
  return exactKeys(value, ['schemaVersion', 'operation'])
    && value.schemaVersion === AI_RUNTIME_STATUS_VERSION
    && value.operation === AI_RUNTIME_STATUS_OPERATION;
}

export function validateAIRuntimeStatusResponse(value) {
  if (!exactKeys(value, [
    'schemaVersion', 'operation', 'target', 'profileScope', 'productionEnabled',
    'rendererActivationAllowed', 'gateway', 'routing', 'models',
  ])) return false;
  if (
    value.schemaVersion !== AI_RUNTIME_STATUS_VERSION
    || value.operation !== AI_RUNTIME_STATUS_OPERATION
    || value.target !== AI_RUNTIME_TARGET
    || value.profileScope !== AI_RUNTIME_PROFILE_SCOPE
    || typeof value.productionEnabled !== 'boolean'
    || value.rendererActivationAllowed !== false
  ) return false;
  if (
    !exactKeys(value.gateway, ['state', 'available'])
    || !AI_GATEWAY_STATUS_STATES.includes(value.gateway.state)
    || typeof value.gateway.available !== 'boolean'
    || value.gateway.available !== (value.gateway.state === 'running')
  ) return false;
  if (
    !exactKeys(value.routing, ['primary', 'fallback', 'maxFallbackAttempts', 'accessMode'])
    || value.routing.primary !== 'gemini'
    || value.routing.fallback !== null
    || value.routing.maxFallbackAttempts !== 0
    || value.routing.accessMode !== 'free_only'
  ) return false;
  return exactKeys(value.models, [
    'catalogVersion', 'verifiedAt', 'defaultModelId', 'available',
    'partiallyVerified', 'openaiEnabled',
  ])
    && value.models.catalogVersion === AI_RUNTIME_MODEL_STATUS.catalogVersion
    && value.models.verifiedAt === AI_RUNTIME_MODEL_STATUS.verifiedAt
    && value.models.defaultModelId === AI_RUNTIME_MODEL_STATUS.defaultModelId
    && JSON.stringify(value.models.available) === JSON.stringify(AI_RUNTIME_MODEL_STATUS.available)
    && JSON.stringify(value.models.partiallyVerified) === JSON.stringify(AI_RUNTIME_MODEL_STATUS.partiallyVerified)
    && value.models.openaiEnabled === false;
}

export function createAIRuntimeStatusResponse(gatewayStatus) {
  const state = AI_GATEWAY_STATUS_STATES.includes(gatewayStatus?.state)
    ? gatewayStatus.state
    : 'unavailable';
  const response = Object.freeze({
    schemaVersion: AI_RUNTIME_STATUS_VERSION,
    operation: AI_RUNTIME_STATUS_OPERATION,
    target: AI_RUNTIME_TARGET,
    profileScope: AI_RUNTIME_PROFILE_SCOPE,
    productionEnabled: gatewayStatus?.enabled === true,
    rendererActivationAllowed: false,
    gateway: Object.freeze({ state, available: state === 'running' }),
    routing: Object.freeze({ primary: 'gemini', fallback: null, maxFallbackAttempts: 0, accessMode: 'free_only' }),
    models: AI_RUNTIME_MODEL_STATUS,
  });
  if (!validateAIRuntimeStatusResponse(response)) throw new TypeError('Status runtime AI tidak valid');
  return response;
}
