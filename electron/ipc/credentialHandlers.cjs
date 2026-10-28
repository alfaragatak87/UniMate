const transportContractsModule = import('../../shared/credentials/transportContracts.mjs');
const transportValidationModule = import('../../shared/credentials/transportValidation.mjs');

const CREDENTIAL_IPC_CHANNELS = Object.freeze({
  STATUS: 'unimate:credentials:status',
  MUTATE: 'unimate:credentials:mutate',
});

const CREDENTIAL_PROVIDER_VALUES = Object.freeze(['openai', 'gemini']);

const ERROR_MESSAGES = Object.freeze({
  invalid_request: 'Permintaan credential tidak valid.',
  ipc_sender_rejected: 'Pengirim IPC tidak diizinkan.',
  mutation_disabled: 'Perubahan credential belum diaktifkan.',
  state_conflict: 'Operasi credential tidak sesuai dengan status saat ini.',
  confirmation_failed: 'Konfirmasi credential tidak dapat diselesaikan.',
  storage_unavailable: 'Penyimpanan credential tidak tersedia.',
  storage_corrupt: 'Penyimpanan credential rusak dan tidak diubah.',
  operation_failed: 'Operasi credential gagal.',
});

function errorEnvelope(code) {
  const safeCode = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'operation_failed';
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code: safeCode, message: ERROR_MESSAGES[safeCode] }),
  });
}

function successEnvelope(response) {
  return Object.freeze({ ok: true, response });
}

function assertRegistrar(ipcMain) {
  if (typeof ipcMain?.handle !== 'function' || typeof ipcMain?.removeHandler !== 'function') {
    throw new TypeError('Registrar IPC credential tidak valid');
  }
}

function registerCredentialHandlers(options = {}) {
  const {
    ipcMain,
    senderPolicy,
    credentialController,
    mutationsEnabled = false,
    allowedMutationProviders = null,
  } = options;
  assertRegistrar(ipcMain);
  if (typeof senderPolicy?.assertTrusted !== 'function') throw new TypeError('Policy IPC credential tidak valid');
  if (typeof credentialController?.execute !== 'function') throw new TypeError('Controller credential IPC tidak valid');
  if (typeof mutationsEnabled !== 'boolean') throw new TypeError('Status mutasi credential tidak valid');
  const mutationProviders = allowedMutationProviders ?? (mutationsEnabled ? CREDENTIAL_PROVIDER_VALUES : []);
  if (
    !Array.isArray(mutationProviders)
    || new Set(mutationProviders).size !== mutationProviders.length
    || mutationProviders.some(provider => !CREDENTIAL_PROVIDER_VALUES.includes(provider))
  ) {
    throw new TypeError('Provider mutasi credential tidak valid');
  }
  const allowedMutationProviderSet = new Set(mutationProviders);

  const installedChannels = [];

  async function execute(event, request, expectedOperations) {
    try {
      senderPolicy.assertTrusted(event);
    } catch {
      return errorEnvelope('ipc_sender_rejected');
    }

    const validation = await transportValidationModule;
    const contracts = await transportContractsModule;
    try {
      validation.assertValidCredentialTransportRequest(request);
    } catch {
      return errorEnvelope('invalid_request');
    }
    if (!expectedOperations.includes(request.operation)) return errorEnvelope('invalid_request');
    if (!mutationsEnabled && request.operation !== contracts.CREDENTIAL_TRANSPORT_OPERATIONS.STATUS) {
      return errorEnvelope('mutation_disabled');
    }
    if (
      request.operation !== contracts.CREDENTIAL_TRANSPORT_OPERATIONS.STATUS
      && !allowedMutationProviderSet.has(request.provider)
    ) {
      return errorEnvelope('mutation_disabled');
    }

    try {
      const response = await credentialController.execute(request);
      validation.assertValidCredentialTransportResponse(response);
      return successEnvelope(response);
    } catch (error) {
      return errorEnvelope(error?.code);
    }
  }

  ipcMain.handle(CREDENTIAL_IPC_CHANNELS.STATUS, async (event, request) => {
    const contracts = await transportContractsModule;
    return execute(event, request, [contracts.CREDENTIAL_TRANSPORT_OPERATIONS.STATUS]);
  });
  installedChannels.push(CREDENTIAL_IPC_CHANNELS.STATUS);

  if (mutationsEnabled) {
    ipcMain.handle(CREDENTIAL_IPC_CHANNELS.MUTATE, async (event, request) => {
      const contracts = await transportContractsModule;
      return execute(event, request, [
        contracts.CREDENTIAL_TRANSPORT_OPERATIONS.CONFIGURE,
        contracts.CREDENTIAL_TRANSPORT_OPERATIONS.REMOVE,
      ]);
    });
    installedChannels.push(CREDENTIAL_IPC_CHANNELS.MUTATE);
  }

  return Object.freeze({
    dispose() {
      for (const channel of installedChannels) ipcMain.removeHandler(channel);
      installedChannels.length = 0;
    },
  });
}

module.exports = {
  CREDENTIAL_IPC_CHANNELS,
  registerCredentialHandlers,
};
