import { AI_CAPABILITIES } from '../../shared/ai/contracts.mjs';
import { validateAIResponse } from '../../shared/ai/validation.mjs';

const UI_SCAN_TYPES = Object.freeze(['auto', 'khs', 'calendar']);

function cloneAndFreeze(value) {
  const cloned = JSON.parse(JSON.stringify(value));
  const freeze = current => {
    if (current === null || typeof current !== 'object' || Object.isFrozen(current)) return current;
    Object.values(current).forEach(freeze);
    return Object.freeze(current);
  };
  return freeze(cloned);
}

export class AIScannerReviewError extends Error {
  constructor() {
    super('Hasil AI Scanner tidak valid.');
    this.name = 'AIScannerReviewError';
    this.code = 'invalid_scanner_result';
  }
}

export function createAIScannerReview(response, scanType) {
  if (
    !UI_SCAN_TYPES.includes(scanType)
    || !validateAIResponse(response).valid
    || response.success !== true
    || response.capability !== AI_CAPABILITIES.DOCUMENT_SCAN
  ) {
    throw new AIScannerReviewError();
  }

  const suggestion = cloneAndFreeze(response.result);
  const defaultDirection = scanType === 'khs' ? 'khs' : (scanType === 'calendar' ? 'event' : 'file');
  const direction = ['unknown', 'file'].includes(suggestion.direction) ? defaultDirection : suggestion.direction;

  return Object.freeze({
    suggestion,
    direction,
    meta: cloneAndFreeze(response.meta),
  });
}
