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

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

function extractOutputText(body) {
  if (typeof body?.output_text === 'string' && body.output_text.length > 0) return body.output_text;
  if (!Array.isArray(body?.output)) throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  const text = body.output
    .filter(item => item?.type === 'message' && item?.status === 'completed' && Array.isArray(item.content))
    .flatMap(item => item.content)
    .filter(part => part?.type === 'output_text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('');
  if (text.length === 0) throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  return text;
}

export function createOpenAIProviderAdapter(options = {}) {
  const config = normalizeProviderConfig(options);

  return Object.freeze({
    provider: AI_PROVIDERS.OPENAI,

    async execute(input) {
      try {
        assertExecutionInput(input);
        if (input.request.selection.provider !== AI_PROVIDERS.OPENAI || input.request.selection.modelId !== config.model) {
          throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.INVALID_REQUEST);
        }
        const prompt = createProviderPrompt(input.request);
        const userContent = [{ type: 'input_text', text: prompt.userText }];
        if (prompt.file) {
          userContent.push({
            type: 'input_file',
            filename: prompt.file.name,
            file_data: `data:${prompt.file.mimeType};base64,${prompt.file.base64}`,
          });
        }
        const response = await config.transport.send({
          url: OPENAI_RESPONSES_URL,
          timeoutMs: config.timeoutMs,
          signal: input.signal,
          headers: {
            Authorization: `Bearer ${input.credential}`,
            'Content-Type': 'application/json',
          },
          body: {
            model: config.model,
            input: [
              { role: 'developer', content: [{ type: 'input_text', text: prompt.instructions }] },
              { role: 'user', content: userContent },
            ],
            max_output_tokens: config.outputTokens[input.request.capability],
            text: {
              format: {
                type: 'json_schema',
                name: 'unimate_result',
                strict: true,
                schema: prompt.schema,
              },
            },
          },
        });
        if (!response.ok) throw new ProviderAdapterError(classifyHttpError(response.status, response.body));
        const result = parseCapabilityResult(input.request, extractOutputText(response.body));
        return Object.freeze({ provider: AI_PROVIDERS.OPENAI, modelId: config.model, result });
      } catch (error) {
        throw normalizeAdapterError(error);
      }
    },
  });
}
