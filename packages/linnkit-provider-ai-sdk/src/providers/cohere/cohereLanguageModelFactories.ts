import { createCohere, VERSION as COHERE_PACKAGE_VERSION } from '@ai-sdk/cohere';
import {
  AI_SDK_INFERENCE_CAPABILITY_IDS,
} from '../../definitions/aiSdkCapabilityIds';
import type { AiSdkLanguageModelFactoryEntry } from '../../definitions/aiSdkInferenceSurface';
import { requireAiSdkLanguageModelCredential } from '../../functions/requireAiSdkLanguageModelCredential';

export const COHERE_LANGUAGE_MODEL_FACTORIES: Record<
  typeof AI_SDK_INFERENCE_CAPABILITY_IDS.COHERE_CHAT,
  AiSdkLanguageModelFactoryEntry
> = {
  [AI_SDK_INFERENCE_CAPABILITY_IDS.COHERE_CHAT]: {
    capability_id: AI_SDK_INFERENCE_CAPABILITY_IDS.COHERE_CHAT,
    surface: 'cohere_chat',
    auth_profiles: ['bearer'],
    package_name: '@ai-sdk/cohere',
    package_version: COHERE_PACKAGE_VERSION,
    createLanguageModel(input) {
      const credential = requireAiSdkLanguageModelCredential(input);
      const provider = createCohere({
        baseURL: input.base_url,
        apiKey: credential.secret,
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.fetch ? { fetch: input.fetch } : {}),
      });
      return provider.languageModel(input.endpoint_model_id);
    },
  },
};
