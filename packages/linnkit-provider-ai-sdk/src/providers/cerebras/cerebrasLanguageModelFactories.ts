import { createCerebras, VERSION as CEREBRAS_PACKAGE_VERSION } from '@ai-sdk/cerebras';
import {
  AI_SDK_INFERENCE_CAPABILITY_IDS,
} from '../../definitions/aiSdkCapabilityIds';
import type { AiSdkLanguageModelFactoryEntry } from '../../definitions/aiSdkInferenceSurface';
import { requireAiSdkLanguageModelCredential } from '../../functions/requireAiSdkLanguageModelCredential';

export const CEREBRAS_LANGUAGE_MODEL_FACTORIES: Record<
  typeof AI_SDK_INFERENCE_CAPABILITY_IDS.CEREBRAS_CHAT,
  AiSdkLanguageModelFactoryEntry
> = {
  [AI_SDK_INFERENCE_CAPABILITY_IDS.CEREBRAS_CHAT]: {
    capability_id: AI_SDK_INFERENCE_CAPABILITY_IDS.CEREBRAS_CHAT,
    surface: 'openai_chat_completions',
    auth_profiles: ['bearer'],
    package_name: '@ai-sdk/cerebras',
    package_version: CEREBRAS_PACKAGE_VERSION,
    createLanguageModel(input) {
      const credential = requireAiSdkLanguageModelCredential(input);
      const provider = createCerebras({
        baseURL: input.base_url,
        apiKey: credential.secret,
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.fetch ? { fetch: input.fetch } : {}),
      });
      return provider.chat(input.endpoint_model_id);
    },
  },
};
