import { createAlibaba, VERSION as ALIBABA_PACKAGE_VERSION } from '@ai-sdk/alibaba';
import { AI_SDK_INFERENCE_CAPABILITY_IDS } from '../../definitions/aiSdkCapabilityIds';
import type { AiSdkLanguageModelFactoryEntry as LanguageModelFactoryEntry } from '../../definitions/aiSdkInferenceSurface';
import { requireAiSdkLanguageModelCredential } from '../../functions/requireAiSdkLanguageModelCredential';

type AlibabaChatCapabilityId = typeof AI_SDK_INFERENCE_CAPABILITY_IDS.ALIBABA_CHAT;

export const ALIBABA_LANGUAGE_MODEL_FACTORIES: Record<
  AlibabaChatCapabilityId,
  LanguageModelFactoryEntry
> = {
  [AI_SDK_INFERENCE_CAPABILITY_IDS.ALIBABA_CHAT]: {
    capability_id: AI_SDK_INFERENCE_CAPABILITY_IDS.ALIBABA_CHAT,
    surface: 'openai_chat_completions',
    auth_profiles: ['bearer'],
    package_name: '@ai-sdk/alibaba',
    package_version: ALIBABA_PACKAGE_VERSION,
    createLanguageModel(input) {
      const credential = requireAiSdkLanguageModelCredential(input);
      const provider = createAlibaba({
        baseURL: input.base_url,
        apiKey: credential.secret,
        includeUsage: true,
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.fetch ? { fetch: input.fetch } : {}),
      });
      return provider.chatModel(input.endpoint_model_id);
    },
  },
};
