const validationModule = import('../../shared/ai/budgetTransportValidation.mjs');

const AI_BUDGET_IPC_CHANNELS = Object.freeze({
  STATUS: 'unimate:ai-budget:status',
  CONFIGURE: 'unimate:ai-budget:configure',
});

const SAFE_ERRORS = Object.freeze({
  invalid_request: 'Permintaan budget AI tidak valid.',
  ipc_sender_rejected: 'Pengirim IPC tidak diizinkan.',
  mutation_disabled: 'Perubahan budget AI belum diaktifkan.',
  confirmation_failed: 'Konfirmasi budget AI tidak dapat diselesaikan.',
  storage_unavailable: 'Penyimpanan budget AI tidak tersedia.',
  operation_failed: 'Operasi budget AI gagal.',
});

function errorEnvelope(code) {
  const safeCode = Object.hasOwn(SAFE_ERRORS, code) ? code : 'operation_failed';
  return Object.freeze({ ok: false, error: Object.freeze({ code: safeCode, message: SAFE_ERRORS[safeCode] }) });
}

function registerAIBudgetHandlers(options = {}) {
  const { ipcMain, senderPolicy, budgetController, mutationsEnabled = false } = options;
  if (typeof ipcMain?.handle !== 'function' || typeof ipcMain?.removeHandler !== 'function') {
    throw new TypeError('Registrar IPC budget AI tidak valid');
  }
  if (typeof senderPolicy?.assertTrusted !== 'function' || typeof budgetController?.execute !== 'function') {
    throw new TypeError('Dependensi IPC budget AI tidak valid');
  }
  if (typeof mutationsEnabled !== 'boolean') throw new TypeError('Status mutasi budget AI tidak valid');
  const channels = [];

  async function execute(event, request, operation) {
    try {
      senderPolicy.assertTrusted(event);
    } catch {
      return errorEnvelope('ipc_sender_rejected');
    }
    const validation = await validationModule;
    if (!validation.validateAIBudgetTransportRequest(request) || request.operation !== operation) {
      return errorEnvelope('invalid_request');
    }
    if (operation === 'configure' && !mutationsEnabled) return errorEnvelope('mutation_disabled');
    try {
      const response = await budgetController.execute(request);
      validation.assertValidAIBudgetTransportResponse(response);
      return Object.freeze({ ok: true, response });
    } catch (error) {
      return errorEnvelope(error?.code);
    }
  }

  ipcMain.handle(AI_BUDGET_IPC_CHANNELS.STATUS, (event, request) => execute(event, request, 'status'));
  channels.push(AI_BUDGET_IPC_CHANNELS.STATUS);
  if (mutationsEnabled) {
    ipcMain.handle(AI_BUDGET_IPC_CHANNELS.CONFIGURE, (event, request) => execute(event, request, 'configure'));
    channels.push(AI_BUDGET_IPC_CHANNELS.CONFIGURE);
  }

  return Object.freeze({
    dispose() {
      for (const channel of channels) ipcMain.removeHandler(channel);
      channels.length = 0;
    },
  });
}

module.exports = {
  AI_BUDGET_IPC_CHANNELS,
  registerAIBudgetHandlers,
};
