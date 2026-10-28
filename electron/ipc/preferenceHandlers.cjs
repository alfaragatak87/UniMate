const validationModule = import('../../shared/ai/preferenceTransportValidation.mjs');

const AI_PREFERENCE_IPC_CHANNELS = Object.freeze({
  STATUS: 'unimate:ai-preference:status',
  UPDATE: 'unimate:ai-preference:update',
});

const SAFE_ERRORS = Object.freeze({
  invalid_request: 'Permintaan preferensi AI tidak valid.',
  ipc_sender_rejected: 'Pengirim IPC tidak diizinkan.',
  storage_corrupt: 'File preferensi AI rusak dan tidak ditimpa otomatis.',
  storage_unavailable: 'Penyimpanan preferensi AI tidak tersedia.',
  operation_failed: 'Operasi preferensi AI gagal.',
});

function errorEnvelope(code) {
  const safeCode = Object.hasOwn(SAFE_ERRORS, code) ? code : 'operation_failed';
  return Object.freeze({ ok: false, error: Object.freeze({ code: safeCode, message: SAFE_ERRORS[safeCode] }) });
}

function registerAIPreferenceHandlers(options = {}) {
  const { ipcMain, senderPolicy, preferenceController } = options;
  if (typeof ipcMain?.handle !== 'function' || typeof ipcMain?.removeHandler !== 'function') {
    throw new TypeError('Registrar IPC preferensi AI tidak valid');
  }
  if (typeof senderPolicy?.assertTrusted !== 'function' || typeof preferenceController?.execute !== 'function') {
    throw new TypeError('Dependensi IPC preferensi AI tidak valid');
  }

  async function execute(event, request, operation) {
    try {
      senderPolicy.assertTrusted(event);
    } catch {
      return errorEnvelope('ipc_sender_rejected');
    }
    const validation = await validationModule;
    if (!validation.validateAIPreferenceRequest(request) || request.operation !== operation) {
      return errorEnvelope('invalid_request');
    }
    try {
      const response = await preferenceController.execute(request);
      validation.assertValidAIPreferenceResponse(response);
      return Object.freeze({ ok: true, response });
    } catch (error) {
      return errorEnvelope(error?.code);
    }
  }

  ipcMain.handle(AI_PREFERENCE_IPC_CHANNELS.STATUS, (event, request) => execute(event, request, 'status'));
  ipcMain.handle(AI_PREFERENCE_IPC_CHANNELS.UPDATE, (event, request) => execute(event, request, 'update'));

  return Object.freeze({
    dispose() {
      ipcMain.removeHandler(AI_PREFERENCE_IPC_CHANNELS.STATUS);
      ipcMain.removeHandler(AI_PREFERENCE_IPC_CHANNELS.UPDATE);
    },
  });
}

module.exports = { AI_PREFERENCE_IPC_CHANNELS, registerAIPreferenceHandlers };
