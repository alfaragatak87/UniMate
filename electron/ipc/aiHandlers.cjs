const aiValidationModule = import('../../shared/ai/validation.mjs');
const aiContractsModule = import('../../shared/ai/contracts.mjs');
const runtimeStatusModule = import('../../shared/ai/runtimeStatusValidation.mjs');

const AI_IPC_CHANNELS = Object.freeze({
  STATUS: 'unimate:ai:status',
  REQUEST: 'unimate:ai:request',
  CANCEL: 'unimate:ai:cancel',
});

const ERROR_MESSAGES = Object.freeze({
  invalid_request: 'Permintaan AI tidak valid.',
  ipc_sender_rejected: 'Pengirim IPC tidak diizinkan.',
  gateway_unavailable: 'Gateway AI lokal tidak tersedia.',
  capability_disabled: 'Fitur AI ini belum diaktifkan.',
  invalid_response: 'Respons Gateway AI tidak valid.',
  request_rejected: 'Permintaan AI dengan ID yang sama sedang diproses.',
  request_cancelled: 'Permintaan AI dibatalkan.',
  quota_exceeded: 'Batas penggunaan Gemini Free Tier tercapai.',
  quota_unavailable: 'Status kuota Gemini Free Tier tidak tersedia.',
  rate_limited: 'Gemini sedang membatasi permintaan.',
  provider_timeout: 'Gemini tidak merespons dalam batas waktu.',
  provider_unavailable: 'Gemini tidak tersedia.',
});

function errorEnvelope(code) {
  const safeCode = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'gateway_unavailable';
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code: safeCode, message: ERROR_MESSAGES[safeCode] }),
  });
}

function registerAIHandlers(options = {}) {
  const { ipcMain, senderPolicy, gatewayRuntime } = options;
  if (typeof ipcMain?.handle !== 'function' || typeof ipcMain?.removeHandler !== 'function') {
    throw new TypeError('Registrar IPC AI tidak valid');
  }
  if (typeof senderPolicy?.assertTrusted !== 'function') throw new TypeError('Policy IPC AI tidak valid');
  if (typeof gatewayRuntime?.requestAI !== 'function') throw new TypeError('Runtime Gateway IPC tidak valid');
  const activeRequests = new Map();

  ipcMain.handle(AI_IPC_CHANNELS.STATUS, async (event, request) => {
    try {
      senderPolicy.assertTrusted(event);
    } catch {
      return errorEnvelope('ipc_sender_rejected');
    }
    const runtimeStatus = await runtimeStatusModule;
    if (!runtimeStatus.validateAIRuntimeStatusRequest(request)) return errorEnvelope('invalid_request');
    try {
      const gatewayStatus = typeof gatewayRuntime.getStatus === 'function'
        ? gatewayRuntime.getStatus()
        : { enabled: false, state: 'unavailable', available: false };
      return Object.freeze({
        ok: true,
        response: runtimeStatus.createAIRuntimeStatusResponse(gatewayStatus),
      });
    } catch {
      return errorEnvelope('invalid_response');
    }
  });

  ipcMain.handle(AI_IPC_CHANNELS.REQUEST, async (event, request) => {
    try {
      senderPolicy.assertTrusted(event);
    } catch {
      return errorEnvelope('ipc_sender_rejected');
    }

    const validation = await aiValidationModule;
    try {
      validation.assertValidAIRequest(request);
    } catch {
      return errorEnvelope('invalid_request');
    }
    if (activeRequests.has(request.requestId)) return errorEnvelope('request_rejected');
    const controller = new AbortController();
    const activeRequest = Object.freeze({ sender: event.sender, controller });
    activeRequests.set(request.requestId, activeRequest);

    try {
      const response = await gatewayRuntime.requestAI(request, { signal: controller.signal });
      if (!validation.validateAIResponse(response).valid) return errorEnvelope('invalid_response');
      return Object.freeze({ ok: true, response });
    } catch (error) {
      return errorEnvelope(error?.code);
    } finally {
      if (activeRequests.get(request.requestId) === activeRequest) activeRequests.delete(request.requestId);
    }
  });

  ipcMain.handle(AI_IPC_CHANNELS.CANCEL, async (event, request) => {
    try {
      senderPolicy.assertTrusted(event);
    } catch {
      return errorEnvelope('ipc_sender_rejected');
    }
    const [validation, contracts] = await Promise.all([aiValidationModule, aiContractsModule]);
    const keys = request !== null && typeof request === 'object' && !Array.isArray(request)
      ? Object.keys(request)
      : [];
    if (
      keys.length !== 2
      || !keys.includes('schemaVersion')
      || !keys.includes('requestId')
      || request.schemaVersion !== contracts.AI_CONTRACT_VERSION
      || !validation.validateAIRequestId(request.requestId)
    ) {
      return errorEnvelope('invalid_request');
    }
    const activeRequest = activeRequests.get(request.requestId);
    if (activeRequest === undefined || activeRequest.sender !== event.sender) {
      return Object.freeze({ ok: true, response: Object.freeze({ requestId: request.requestId, cancelled: false }) });
    }
    activeRequest.controller.abort();
    return Object.freeze({ ok: true, response: Object.freeze({ requestId: request.requestId, cancelled: true }) });
  });

  return Object.freeze({
    dispose() {
      for (const activeRequest of activeRequests.values()) activeRequest.controller.abort();
      activeRequests.clear();
      ipcMain.removeHandler(AI_IPC_CHANNELS.STATUS);
      ipcMain.removeHandler(AI_IPC_CHANNELS.REQUEST);
      ipcMain.removeHandler(AI_IPC_CHANNELS.CANCEL);
    },
  });
}

module.exports = {
  AI_IPC_CHANNELS,
  registerAIHandlers,
};
