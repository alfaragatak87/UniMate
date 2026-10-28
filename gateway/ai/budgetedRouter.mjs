import {
  AI_ACCESS_MODES,
  AI_CONTRACT_VERSION,
  AI_ERROR_CODES,
} from '../../shared/ai/contracts.mjs';
import { assertValidAIResponse } from '../../shared/ai/validation.mjs';
import { AIBudgetGuardError } from './budgetGuard.mjs';
import { AIFreeTierQuotaError } from './freeTierQuotaGuard.mjs';

function guardErrorResponse(request, code) {
  const safeCode = [
    AI_ERROR_CODES.QUOTA_EXCEEDED,
    AI_ERROR_CODES.QUOTA_UNAVAILABLE,
    AI_ERROR_CODES.BUDGET_NOT_CONFIGURED,
    AI_ERROR_CODES.BUDGET_EXCEEDED,
    AI_ERROR_CODES.BUDGET_UNAVAILABLE,
  ].includes(code) ? code : AI_ERROR_CODES.BUDGET_UNAVAILABLE;
  const messages = {
    [AI_ERROR_CODES.QUOTA_EXCEEDED]: 'Batas penggunaan lokal Gemini Free Tier telah tercapai.',
    [AI_ERROR_CODES.QUOTA_UNAVAILABLE]: 'Pemeriksaan kuota Gemini Free Tier tidak tersedia.',
    [AI_ERROR_CODES.BUDGET_NOT_CONFIGURED]: 'Batas biaya AI belum dikonfigurasi dan disetujui.',
    [AI_ERROR_CODES.BUDGET_EXCEEDED]: 'Estimasi biaya permintaan melampaui batas yang dikonfigurasi.',
    [AI_ERROR_CODES.BUDGET_UNAVAILABLE]: 'Pemeriksaan budget AI tidak tersedia.',
  };
  return assertValidAIResponse({
    schemaVersion: AI_CONTRACT_VERSION,
    requestId: request.requestId,
    capability: request.capability,
    success: false,
    error: {
      code: safeCode,
      message: messages[safeCode],
      primaryReason: null,
      fallbackReason: null,
    },
  });
}

export function createBudgetedAIRouter(options = {}) {
  const { router, budgetGuard, quotaGuard } = options;
  if (typeof router?.route !== 'function') throw new TypeError('Router AI budget tidak valid');
  const budgetGuardAvailable = typeof budgetGuard?.reserve === 'function'
    && typeof budgetGuard?.settle === 'function'
    && typeof budgetGuard?.markUnknown === 'function';
  const quotaGuardAvailable = typeof quotaGuard?.reserve === 'function'
    && typeof quotaGuard?.settle === 'function'
    && typeof quotaGuard?.markUnknown === 'function';

  return Object.freeze({
    async route(request, routeOptions = {}) {
      if (routeOptions.signal?.aborted) return router.route(request, routeOptions);
      const freeOnly = request.selection?.accessMode === AI_ACCESS_MODES.FREE_ONLY;
      const guard = freeOnly ? quotaGuard : budgetGuard;
      if (freeOnly && !quotaGuardAvailable) return guardErrorResponse(request, AI_ERROR_CODES.QUOTA_UNAVAILABLE);
      if (!freeOnly && !budgetGuardAvailable) return guardErrorResponse(request, AI_ERROR_CODES.BUDGET_NOT_CONFIGURED);
      let reservation;
      try {
        reservation = await guard.reserve(request, { signal: routeOptions.signal });
      } catch (error) {
        const code = error instanceof AIFreeTierQuotaError || error instanceof AIBudgetGuardError
          ? error.code
          : freeOnly ? AI_ERROR_CODES.QUOTA_UNAVAILABLE : AI_ERROR_CODES.BUDGET_UNAVAILABLE;
        if (code === 'request_cancelled') return router.route(request, routeOptions);
        return guardErrorResponse(request, code);
      }
      let response;
      try {
        response = await router.route(request, routeOptions);
      } catch (error) {
        try { await guard.markUnknown(reservation); } catch {}
        throw error;
      }
      try {
        await guard.settle(reservation, response);
      } catch {
        return guardErrorResponse(
          request,
          freeOnly ? AI_ERROR_CODES.QUOTA_UNAVAILABLE : AI_ERROR_CODES.BUDGET_UNAVAILABLE,
        );
      }
      return response;
    },
  });
}
