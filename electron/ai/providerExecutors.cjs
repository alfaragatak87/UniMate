const geminiAdapterModule = import('../../gateway/ai/providers/geminiProviderAdapter.mjs');
const providerTransportModule = import('../../gateway/ai/providers/providerHttpTransport.mjs');
const modelCatalogModule = import('../../shared/ai/modelCatalog.mjs');

async function createProviderExecutors(options = {}) {
  const { models, transport, timeoutMs, outputTokens } = options;
  const [{ createGeminiProviderAdapter }, { createProviderHttpTransport }, catalog] = await Promise.all([
    geminiAdapterModule,
    providerTransportModule,
    modelCatalogModule,
  ]);
  const resolvedModels = catalog.resolveAllowedAIModels(models);
  const resolvedTransport = transport ?? createProviderHttpTransport();
  const gemini = {};
  for (const modelId of resolvedModels.gemini) {
    if (catalog.getAIModel(modelId)?.selectable !== true) continue;
    const adapter = createGeminiProviderAdapter({ model: modelId, transport: resolvedTransport, timeoutMs, outputTokens });
    gemini[modelId] = input => adapter.execute(input);
  }
  if (Object.keys(gemini).length < 1) throw new TypeError('Tidak ada model Gemini aktif');
  return Object.freeze({
    gemini: Object.freeze(gemini),
    openai: Object.freeze({}),
  });
}

module.exports = { createProviderExecutors };
