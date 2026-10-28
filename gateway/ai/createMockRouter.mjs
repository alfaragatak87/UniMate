import { AI_PROVIDERS } from '../../shared/ai/contracts.mjs';
import { AI_DEFAULT_MODEL_ID } from '../../shared/ai/modelCatalog.mjs';
import {
  MOCK_PROVIDER_SCENARIOS,
  createMockProvider,
} from './providers/mockProvider.mjs';
import { createAIRouter } from './router.mjs';

export function createMockRouter(options = {}) {
  const {
    responses,
    primaryScenario = MOCK_PROVIDER_SCENARIOS.SUCCESS,
  } = options;

  if (responses === null || typeof responses !== 'object' || Array.isArray(responses)) {
    throw new TypeError('responses mock wajib berupa object');
  }

  const primaryProvider = createMockProvider({
    provider: AI_PROVIDERS.GEMINI,
    modelId: AI_DEFAULT_MODEL_ID,
    scenario: primaryScenario,
    responses,
  });
  const router = createAIRouter({
    providers: { [AI_DEFAULT_MODEL_ID]: primaryProvider },
  });

  return Object.freeze({ router, primaryProvider, fallbackProvider: null });
}
