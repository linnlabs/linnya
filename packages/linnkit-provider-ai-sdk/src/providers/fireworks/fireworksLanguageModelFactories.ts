import { createFireworks, VERSION as FIREWORKS_PACKAGE_VERSION } from '@ai-sdk/fireworks';
import {
  AI_SDK_INFERENCE_CAPABILITY_IDS,
} from '../../definitions/aiSdkCapabilityIds';
import type { AiSdkLanguageModelFactoryEntry } from '../../definitions/aiSdkInferenceSurface';
import { requireAiSdkLanguageModelCredential } from '../../functions/requireAiSdkLanguageModelCredential';

export const FIREWORKS_LANGUAGE_MODEL_FACTORIES: Record<
  typeof AI_SDK_INFERENCE_CAPABILITY_IDS.FIREWORKS_CHAT,
  AiSdkLanguageModelFactoryEntry
> = {
  [AI_SDK_INFERENCE_CAPABILITY_IDS.FIREWORKS_CHAT]: {
    capability_id: AI_SDK_INFERENCE_CAPABILITY_IDS.FIREWORKS_CHAT,
    surface: 'openai_chat_completions',
    auth_profiles: ['bearer'],
    package_name: '@ai-sdk/fireworks',
    package_version: FIREWORKS_PACKAGE_VERSION,
    createLanguageModel(input) {
      const credential = requireAiSdkLanguageModelCredential(input);
      const provider = createFireworks({
        baseURL: input.base_url,
        apiKey: credential.secret,
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.fetch ? { fetch: input.fetch } : {}),
      });
      return provider.chatModel(input.endpoint_model_id);
    },
  },
};
