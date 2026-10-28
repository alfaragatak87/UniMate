import {
  CREDENTIAL_PROVIDER_VALUES,
} from '../../shared/credentials/contracts.mjs';
import {
  CREDENTIAL_CONFIGURATION_MODES,
  CREDENTIAL_TRANSPORT_OPERATIONS,
  CREDENTIAL_TRANSPORT_VERSION,
} from '../../shared/credentials/transportContracts.mjs';
import {
  validateCredentialTransportRequest,
  validateCredentialTransportResponse,
} from '../../shared/credentials/transportValidation.mjs';

const SAFE_ERROR_CODES = Object.freeze(new Set([
  'invalid_request',
  'ipc_sender_rejected',
  'mutation_disabled',
  'state_conflict',
  'confirmation_failed',
  'storage_unavailable',
  'storage_corrupt',
  'operation_failed',
]));

export class CredentialClientError extends Error {
  constructor(code) {
    super('Operasi credential tidak dapat diselesaikan.');
    this.name = 'CredentialClientError';
    this.code = SAFE_ERROR_CODES.has(code) ? code : 'operation_failed';
  }
}

function assertEnvelope(envelope) {
  if (
    envelope === null
    || typeof envelope !== 'object'
    || Array.isArray(envelope)
    || typeof envelope.ok !== 'boolean'
  ) {
    throw new CredentialClientError('operation_failed');
  }
  if (envelope.ok !== true) throw new CredentialClientError(envelope.error?.code);
  if (!validateCredentialTransportResponse(envelope.response).valid) {
    throw new CredentialClientError('operation_failed');
  }
  return envelope.response;
}

export function createCredentialClient(options = {}) {
  const {
    statusTransport,
    mutationTransport = null,
    allowedMutationProviders = mutationTransport === null ? [] : CREDENTIAL_PROVIDER_VALUES,
  } = options;
  if (typeof statusTransport !== 'function') throw new TypeError('Transport status credential tidak valid');
  if (mutationTransport !== null && typeof mutationTransport !== 'function') {
    throw new TypeError('Transport mutasi credential tidak valid');
  }
  if (
    !Array.isArray(allowedMutationProviders)
    || new Set(allowedMutationProviders).size !== allowedMutationProviders.length
    || allowedMutationProviders.some(provider => !CREDENTIAL_PROVIDER_VALUES.includes(provider))
    || (mutationTransport === null && allowedMutationProviders.length > 0)
  ) {
    throw new TypeError('Provider mutasi credential tidak valid');
  }
  const allowedMutationProviderSet = new Set(allowedMutationProviders);

  function assertMutationAllowed(provider) {
    if (!CREDENTIAL_PROVIDER_VALUES.includes(provider)) {
      throw new CredentialClientError('invalid_request');
    }
    if (mutationTransport === null || !allowedMutationProviderSet.has(provider)) {
      throw new CredentialClientError('mutation_disabled');
    }
  }

  async function execute(transport, request) {
    if (!validateCredentialTransportRequest(request).valid) {
      throw new CredentialClientError('invalid_request');
    }
    let envelope;
    try {
      envelope = await transport(request);
    } catch {
      throw new CredentialClientError('operation_failed');
    }
    return assertEnvelope(envelope);
  }

  return Object.freeze({
    canMutate: (provider = null) => provider === null
      ? mutationTransport !== null && allowedMutationProviderSet.size > 0
      : allowedMutationProviderSet.has(provider),

    async getStatus() {
      const response = await execute(statusTransport, {
        schemaVersion: CREDENTIAL_TRANSPORT_VERSION,
        operation: CREDENTIAL_TRANSPORT_OPERATIONS.STATUS,
      });
      return response.status;
    },

    configure(provider, mode, credential) {
      assertMutationAllowed(provider);
      return execute(mutationTransport, {
        schemaVersion: CREDENTIAL_TRANSPORT_VERSION,
        operation: CREDENTIAL_TRANSPORT_OPERATIONS.CONFIGURE,
        provider,
        mode,
        credential,
      });
    },

    remove(provider) {
      assertMutationAllowed(provider);
      return execute(mutationTransport, {
        schemaVersion: CREDENTIAL_TRANSPORT_VERSION,
        operation: CREDENTIAL_TRANSPORT_OPERATIONS.REMOVE,
        provider,
      });
    },

    configurationModes: CREDENTIAL_CONFIGURATION_MODES,
  });
}

const electronApi = globalThis.window?.electronAPI;

export const credentialClient = createCredentialClient({
  statusTransport: request => {
    if (typeof electronApi?.getCredentialStatus !== 'function') {
      throw new CredentialClientError('storage_unavailable');
    }
    return electronApi.getCredentialStatus(request);
  },
  mutationTransport: electronApi?.credentialMutationsEnabled === true
    && typeof electronApi?.mutateCredential === 'function'
    ? request => electronApi.mutateCredential(request)
    : null,
  allowedMutationProviders: electronApi?.credentialMutationsEnabled === true
    && typeof electronApi?.mutateCredential === 'function'
    ? ['gemini']
    : [],
});
