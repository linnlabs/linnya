import { createMiniMax, VERSION as MINIMAX_PACKAGE_VERSION } from '@ai-sdk/minimax';
import {
  AI_SDK_INFERENCE_CAPABILITY_IDS,
} from '../../definitions/aiSdkCapabilityIds';
import type { AiSdkLanguageModelFactoryEntry } from '../../definitions/aiSdkInferenceSurface';
import { requireAiSdkLanguageModelCredential } from '../../functions/requireAiSdkLanguageModelCredential';

export const MINIMAX_LANGUAGE_MODEL_FACTORIES: Record<
  typeof AI_SDK_INFERENCE_CAPABILITY_IDS.MINIMAX_CHAT,
  AiSdkLanguageModelFactoryEntry
> = {
  [AI_SDK_INFERENCE_CAPABILITY_IDS.MINIMAX_CHAT]: {
    capability_id: AI_SDK_INFERENCE_CAPABILITY_IDS.MINIMAX_CHAT,
    surface: 'anthropic_messages',
    auth_profiles: ['api_key'],
    package_name: '@ai-sdk/minimax',
    package_version: MINIMAX_PACKAGE_VERSION,
    createLanguageModel(input) {
      const credential = requireAiSdkLanguageModelCredential(input);
      const provider = createMiniMax({
        baseURL: input.base_url,
        apiKey: credential.secret,
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.fetch ? { fetch: input.fetch } : {}),
      });
      return provider.chat(input.endpoint_model_id);
    },
  },
};
