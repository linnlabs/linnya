import { createMistral, VERSION as MISTRAL_PACKAGE_VERSION } from '@ai-sdk/mistral';
import {
  AI_SDK_INFERENCE_CAPABILITY_IDS,
} from '../../definitions/aiSdkCapabilityIds';
import type { AiSdkLanguageModelFactoryEntry } from '../../definitions/aiSdkInferenceSurface';
import { requireAiSdkLanguageModelCredential } from '../../functions/requireAiSdkLanguageModelCredential';

export const MISTRAL_LANGUAGE_MODEL_FACTORIES: Record<
  typeof AI_SDK_INFERENCE_CAPABILITY_IDS.MISTRAL_CHAT,
  AiSdkLanguageModelFactoryEntry
> = {
  [AI_SDK_INFERENCE_CAPABILITY_IDS.MISTRAL_CHAT]: {
    capability_id: AI_SDK_INFERENCE_CAPABILITY_IDS.MISTRAL_CHAT,
    surface: 'openai_chat_completions',
    auth_profiles: ['bearer'],
    package_name: '@ai-sdk/mistral',
    package_version: MISTRAL_PACKAGE_VERSION,
    createLanguageModel(input) {
      const credential = requireAiSdkLanguageModelCredential(input);
      const provider = createMistral({
        baseURL: input.base_url,
        apiKey: credential.secret,
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.fetch ? { fetch: input.fetch } : {}),
      });
      return provider.chat(input.endpoint_model_id);
    },
  },
};
