import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import openRouterPackage from '@openrouter/ai-sdk-provider/package.json' with { type: 'json' };
import {
  AI_SDK_INFERENCE_CAPABILITY_IDS,
} from '../../definitions/aiSdkCapabilityIds';
import type { AiSdkLanguageModelFactoryEntry } from '../../definitions/aiSdkInferenceSurface';
import { requireAiSdkLanguageModelCredential } from '../../functions/requireAiSdkLanguageModelCredential';

export const OPENROUTER_LANGUAGE_MODEL_FACTORIES: Record<
  typeof AI_SDK_INFERENCE_CAPABILITY_IDS.OPENROUTER_CHAT,
  AiSdkLanguageModelFactoryEntry
> = {
  [AI_SDK_INFERENCE_CAPABILITY_IDS.OPENROUTER_CHAT]: {
    capability_id: AI_SDK_INFERENCE_CAPABILITY_IDS.OPENROUTER_CHAT,
    surface: 'openai_chat_completions',
    auth_profiles: ['bearer'],
    package_name: '@openrouter/ai-sdk-provider',
    package_version: openRouterPackage.version,
    createLanguageModel(input) {
      const credential = requireAiSdkLanguageModelCredential(input);
      const provider = createOpenRouter({
        baseURL: input.base_url,
        apiKey: credential.secret,
        compatibility: 'strict',
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.fetch ? { fetch: input.fetch } : {}),
      });
      return provider.chat(input.endpoint_model_id);
    },
  },
};
