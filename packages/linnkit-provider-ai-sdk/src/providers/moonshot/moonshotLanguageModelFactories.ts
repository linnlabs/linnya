import { createMoonshotAI, VERSION as MOONSHOT_PACKAGE_VERSION } from '@ai-sdk/moonshotai';
import {
  AI_SDK_INFERENCE_CAPABILITY_IDS,
} from '../../definitions/aiSdkCapabilityIds';
import type { AiSdkLanguageModelFactoryEntry } from '../../definitions/aiSdkInferenceSurface';
import { requireAiSdkLanguageModelCredential } from '../../functions/requireAiSdkLanguageModelCredential';

export const MOONSHOT_LANGUAGE_MODEL_FACTORIES: Record<
  typeof AI_SDK_INFERENCE_CAPABILITY_IDS.MOONSHOT_CHAT,
  AiSdkLanguageModelFactoryEntry
> = {
  [AI_SDK_INFERENCE_CAPABILITY_IDS.MOONSHOT_CHAT]: {
    capability_id: AI_SDK_INFERENCE_CAPABILITY_IDS.MOONSHOT_CHAT,
    surface: 'openai_chat_completions',
    auth_profiles: ['bearer'],
    package_name: '@ai-sdk/moonshotai',
    package_version: MOONSHOT_PACKAGE_VERSION,
    createLanguageModel(input) {
      const credential = requireAiSdkLanguageModelCredential(input);
      const provider = createMoonshotAI({
        baseURL: input.base_url,
        apiKey: credential.secret,
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.fetch ? { fetch: input.fetch } : {}),
      });
      return provider.chatModel(input.endpoint_model_id);
    },
  },
};
