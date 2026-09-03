import {
  createOpenAICompatible,
  VERSION as OPENAI_COMPATIBLE_PACKAGE_VERSION,
} from '@ai-sdk/openai-compatible';
import {
  AI_SDK_INFERENCE_CAPABILITY_IDS,
} from '../../definitions/aiSdkCapabilityIds';
import type { AiSdkLanguageModelFactoryEntry } from '../../definitions/aiSdkInferenceSurface';

export const OPENAI_COMPATIBLE_LANGUAGE_MODEL_FACTORIES: Record<
  typeof AI_SDK_INFERENCE_CAPABILITY_IDS.OPENAI_COMPATIBLE_CHAT,
  AiSdkLanguageModelFactoryEntry
> = {
  [AI_SDK_INFERENCE_CAPABILITY_IDS.OPENAI_COMPATIBLE_CHAT]: {
    capability_id: AI_SDK_INFERENCE_CAPABILITY_IDS.OPENAI_COMPATIBLE_CHAT,
    surface: 'openai_chat_completions',
    auth_profiles: ['none', 'bearer'],
    package_name: '@ai-sdk/openai-compatible',
    package_version: OPENAI_COMPATIBLE_PACKAGE_VERSION,
    createLanguageModel(input) {
      const provider = createOpenAICompatible({
        name: input.endpoint_id,
        baseURL: input.base_url,
        includeUsage: true,
        ...(input.credential ? { apiKey: input.credential.secret } : {}),
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.fetch ? { fetch: input.fetch } : {}),
      });
      return provider.languageModel(input.endpoint_model_id);
    },
  },
};
