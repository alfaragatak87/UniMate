import {
  AI_PROVIDER_ERROR_CODES,
  AI_PROVIDERS,
} from '../../../shared/ai/contracts.mjs';
import {
  ProviderAdapterError,
  assertExecutionInput,
  classifyHttpError,
  createProviderPrompt,
  normalizeAdapterError,
  normalizeProviderConfig,
  parseCapabilityResult,
} from './providerAdapterSupport.mjs';

function extractCandidateText(body) {
  if (typeof body?.promptFeedback?.blockReason === 'string') {
    throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  }
  const candidate = body?.candidates?.[0];
  if (candidate?.finishReason !== 'STOP' || !Array.isArray(candidate?.content?.parts)) {
    throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  }
  const text = candidate.content.parts
    .filter(part => typeof part?.text === 'string')
    .map(part => part.text)
    .join('');
  if (text.length === 0) throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  return text;
}

export function createGeminiProviderAdapter(options = {}) {
  const config = normalizeProviderConfig(options);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;

  return Object.freeze({
    provider: AI_PROVIDERS.GEMINI,

    async execute(input) {
      try {
        assertExecutionInput(input);
        if (input.request.selection.provider !== AI_PROVIDERS.GEMINI || input.request.selection.modelId !== config.model) {
          throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.INVALID_REQUEST);
        }
        const prompt = createProviderPrompt(input.request);
        const parts = [{ text: prompt.userText }];
        if (prompt.file) {
          parts.push({
            inlineData: {
              mimeType: prompt.file.mimeType,
              data: prompt.file.base64,
            },
          });
        }
        const response = await config.transport.send({
          url: endpoint,
          timeoutMs: config.timeoutMs,
          signal: input.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': input.credential,
          },
          body: {
            systemInstruction: { parts: [{ text: prompt.instructions }] },
            contents: [{ role: 'user', parts }],
            generationConfig: {
              maxOutputTokens: config.outputTokens[input.request.capability],
              responseMimeType: 'application/json',
              responseJsonSchema: prompt.schema,
            },
          },
        });
        if (!response.ok) throw new ProviderAdapterError(classifyHttpError(response.status, response.body));
        const result = parseCapabilityResult(input.request, extractCandidateText(response.body));
        return Object.freeze({ provider: AI_PROVIDERS.GEMINI, modelId: config.model, result });
      } catch (error) {
        throw normalizeAdapterError(error);
      }
    },
  });
}
