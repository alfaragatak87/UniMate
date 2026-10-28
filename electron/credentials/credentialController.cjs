const contractModule = import('../../shared/credentials/contracts.mjs');
const transportContractModule = import('../../shared/credentials/transportContracts.mjs');
const transportValidationModule = import('../../shared/credentials/transportValidation.mjs');
const credentialValidationModule = import('../../shared/credentials/validation.mjs');

const ERROR_MESSAGES = Object.freeze({
  invalid_request: 'Permintaan credential tidak valid.',
  state_conflict: 'Operasi credential tidak sesuai dengan status saat ini.',
  confirmation_failed: 'Konfirmasi credential tidak dapat diselesaikan.',
  storage_unavailable: 'Penyimpanan credential tidak tersedia.',
  storage_corrupt: 'Penyimpanan credential rusak dan tidak diubah.',
  invalid_service_response: 'Respons backend credential tidak valid.',
  operation_failed: 'Operasi credential gagal.',
});

class CredentialControllerError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.operation_failed);
    this.name = 'CredentialControllerError';
    this.code = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'operation_failed';
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every(key => keys.includes(key));
}

function assertDependencies(credentialService, confirmMutation) {
  if (
    credentialService === null
    || typeof credentialService !== 'object'
    || typeof credentialService.getStatus !== 'function'
    || typeof credentialService.configure !== 'function'
    || typeof credentialService.remove !== 'function'
  ) {
    throw new TypeError('Credential service controller tidak valid');
  }
  if (typeof confirmMutation !== 'function') throw new TypeError('Konfirmasi credential controller tidak valid');
}

function mapServiceError(error) {
  if (error?.code === 'storage_unavailable') return new CredentialControllerError('storage_unavailable');
  if (error?.code === 'storage_corrupt') return new CredentialControllerError('storage_corrupt');
  return new CredentialControllerError('operation_failed');
}

function assertStatusSemantics(status, contracts) {
  const { CREDENTIAL_PROVIDERS, CREDENTIAL_STATES, CREDENTIAL_STORAGE_STATES } = contracts;
  const states = Object.values(CREDENTIAL_PROVIDERS).map(provider => status.providers[provider]);
  const expected = {
    [CREDENTIAL_STORAGE_STATES.MISSING]: CREDENTIAL_STATES.MISSING,
    [CREDENTIAL_STORAGE_STATES.CORRUPT]: CREDENTIAL_STATES.CORRUPT,
    [CREDENTIAL_STORAGE_STATES.UNAVAILABLE]: CREDENTIAL_STATES.UNAVAILABLE,
  }[status.storage];
  if (expected !== undefined && states.some(state => state !== expected)) {
    throw new CredentialControllerError('invalid_service_response');
  }
  if (
    status.storage === CREDENTIAL_STORAGE_STATES.READY
    && states.some(state => ![CREDENTIAL_STATES.MISSING, CREDENTIAL_STATES.CONFIGURED].includes(state))
  ) {
    throw new CredentialControllerError('invalid_service_response');
  }
}

function cloneStatus(status) {
  return Object.freeze({
    schemaVersion: status.schemaVersion,
    storage: status.storage,
    providers: Object.freeze({
      openai: status.providers.openai,
      gemini: status.providers.gemini,
    }),
  });
}

function assertConfigureResult(result, provider, replaced) {
  try {
    if (
      hasExactKeys(result, ['provider', 'configured', 'replaced'])
      && result.provider === provider
      && result.configured === true
      && result.replaced === replaced
    ) return;
  } catch {}
  throw new CredentialControllerError('invalid_service_response');
}

function assertRemoveResult(result, provider) {
  try {
    if (
      hasExactKeys(result, ['provider', 'configured', 'removed'])
      && result.provider === provider
      && result.configured === false
      && result.removed === true
    ) return;
  } catch {}
  throw new CredentialControllerError('invalid_service_response');
}

function createCredentialController(options = {}) {
  const { credentialService, confirmMutation } = options;
  assertDependencies(credentialService, confirmMutation);
  let mutationQueue = Promise.resolve();

  function serializeMutation(operation) {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.catch(() => undefined);
    return result;
  }

  async function createResponse(response) {
    const { assertValidCredentialTransportResponse } = await transportValidationModule;
    try {
      assertValidCredentialTransportResponse(response);
    } catch {
      throw new CredentialControllerError('invalid_service_response');
    }
    return Object.freeze(response);
  }

  async function readStatus() {
    let status;
    try {
      status = await credentialService.getStatus();
    } catch (error) {
      throw mapServiceError(error);
    }
    const contracts = await contractModule;
    const { validateCredentialStatus } = await credentialValidationModule;
    try {
      if (!validateCredentialStatus(status).valid) throw new CredentialControllerError('invalid_service_response');
      assertStatusSemantics(status, contracts);
      return cloneStatus(status);
    } catch (error) {
      if (error instanceof CredentialControllerError) throw error;
      throw new CredentialControllerError('invalid_service_response');
    }
  }

  async function requestConfirmation(action, provider) {
    let confirmed;
    try {
      confirmed = await confirmMutation(Object.freeze({ action, provider }));
    } catch {
      throw new CredentialControllerError('confirmation_failed');
    }
    if (typeof confirmed !== 'boolean') throw new CredentialControllerError('confirmation_failed');
    return confirmed;
  }

  async function createMutationResponse(operation, provider, outcome, changed) {
    const { CREDENTIAL_TRANSPORT_VERSION } = await transportContractModule;
    return createResponse({ schemaVersion: CREDENTIAL_TRANSPORT_VERSION, operation, provider, outcome, changed });
  }

  async function processConfigure(request) {
    const contracts = await contractModule;
    const transport = await transportContractModule;
    const status = await readStatus();
    const providerState = status.providers[request.provider];

    if (status.storage === contracts.CREDENTIAL_STORAGE_STATES.UNAVAILABLE) {
      throw new CredentialControllerError('storage_unavailable');
    }
    if (status.storage === contracts.CREDENTIAL_STORAGE_STATES.CORRUPT) {
      throw new CredentialControllerError('storage_corrupt');
    }

    const isCreate = request.mode === transport.CREDENTIAL_CONFIGURATION_MODES.CREATE;
    const expectedState = isCreate ? contracts.CREDENTIAL_STATES.MISSING : contracts.CREDENTIAL_STATES.CONFIGURED;
    if (providerState !== expectedState) throw new CredentialControllerError('state_conflict');

    const operation = isCreate
      ? transport.CREDENTIAL_RESPONSE_OPERATIONS.CONFIGURE
      : transport.CREDENTIAL_RESPONSE_OPERATIONS.REPLACE;
    const action = isCreate
      ? transport.CREDENTIAL_CONFIRMATION_ACTIONS.CONFIGURE
      : transport.CREDENTIAL_CONFIRMATION_ACTIONS.REPLACE;
    const confirmed = await requestConfirmation(action, request.provider);
    if (!confirmed) {
      return createMutationResponse(
        operation,
        request.provider,
        transport.CREDENTIAL_MUTATION_OUTCOMES.CANCELLED,
        false,
      );
    }

    let result;
    try {
      result = await credentialService.configure({
        schemaVersion: contracts.CREDENTIAL_CONTRACT_VERSION,
        provider: request.provider,
        credential: request.credential,
      });
    } catch (error) {
      throw mapServiceError(error);
    }
    assertConfigureResult(result, request.provider, !isCreate);
    return createMutationResponse(
      operation,
      request.provider,
      transport.CREDENTIAL_MUTATION_OUTCOMES.COMPLETED,
      true,
    );
  }

  async function processRemove(request) {
    const contracts = await contractModule;
    const transport = await transportContractModule;
    const status = await readStatus();
    const providerState = status.providers[request.provider];

    if (status.storage === contracts.CREDENTIAL_STORAGE_STATES.UNAVAILABLE) {
      throw new CredentialControllerError('storage_unavailable');
    }
    if (status.storage === contracts.CREDENTIAL_STORAGE_STATES.CORRUPT) {
      throw new CredentialControllerError('storage_corrupt');
    }
    if (providerState === contracts.CREDENTIAL_STATES.MISSING) {
      return createMutationResponse(
        transport.CREDENTIAL_RESPONSE_OPERATIONS.REMOVE,
        request.provider,
        transport.CREDENTIAL_MUTATION_OUTCOMES.COMPLETED,
        false,
      );
    }
    if (providerState !== contracts.CREDENTIAL_STATES.CONFIGURED) {
      throw new CredentialControllerError('state_conflict');
    }

    const confirmed = await requestConfirmation(transport.CREDENTIAL_CONFIRMATION_ACTIONS.REMOVE, request.provider);
    if (!confirmed) {
      return createMutationResponse(
        transport.CREDENTIAL_RESPONSE_OPERATIONS.REMOVE,
        request.provider,
        transport.CREDENTIAL_MUTATION_OUTCOMES.CANCELLED,
        false,
      );
    }

    let result;
    try {
      result = await credentialService.remove({
        schemaVersion: contracts.CREDENTIAL_CONTRACT_VERSION,
        provider: request.provider,
        confirm: true,
      });
    } catch (error) {
      throw mapServiceError(error);
    }
    assertRemoveResult(result, request.provider);
    return createMutationResponse(
      transport.CREDENTIAL_RESPONSE_OPERATIONS.REMOVE,
      request.provider,
      transport.CREDENTIAL_MUTATION_OUTCOMES.COMPLETED,
      true,
    );
  }

  async function execute(request) {
    const validation = await transportValidationModule;
    let safeRequest;
    try {
      validation.assertValidCredentialTransportRequest(request);
      safeRequest = request.operation === 'configure'
        ? Object.freeze({
          operation: request.operation,
          provider: request.provider,
          mode: request.mode,
          credential: request.credential,
        })
        : Object.freeze({ operation: request.operation, provider: request.provider });
    } catch {
      throw new CredentialControllerError('invalid_request');
    }
    const transport = await transportContractModule;
    if (safeRequest.operation === transport.CREDENTIAL_TRANSPORT_OPERATIONS.STATUS) {
      const status = await readStatus();
      return createResponse({
        schemaVersion: transport.CREDENTIAL_TRANSPORT_VERSION,
        operation: transport.CREDENTIAL_RESPONSE_OPERATIONS.STATUS,
        status,
      });
    }
    return serializeMutation(() => (
      safeRequest.operation === transport.CREDENTIAL_TRANSPORT_OPERATIONS.CONFIGURE
        ? processConfigure(safeRequest)
        : processRemove(safeRequest)
    ));
  }

  return Object.freeze({ execute });
}

module.exports = {
  CredentialControllerError,
  createCredentialController,
};
