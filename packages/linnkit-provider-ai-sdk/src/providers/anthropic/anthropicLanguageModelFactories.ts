import { createAnthropic, VERSION as ANTHROPIC_PACKAGE_VERSION } from '@ai-sdk/anthropic';
import {
  AI_SDK_INFERENCE_CAPABILITY_IDS,
} from '../../definitions/aiSdkCapabilityIds';
import type { AiSdkLanguageModelFactoryEntry } from '../../definitions/aiSdkInferenceSurface';
import { requireAiSdkLanguageModelCredential } from '../../functions/requireAiSdkLanguageModelCredential';

export const ANTHROPIC_LANGUAGE_MODEL_FACTORIES: Record<
  typeof AI_SDK_INFERENCE_CAPABILITY_IDS.ANTHROPIC_MESSAGES,
  AiSdkLanguageModelFactoryEntry
> = {
  [AI_SDK_INFERENCE_CAPABILITY_IDS.ANTHROPIC_MESSAGES]: {
    capability_id: AI_SDK_INFERENCE_CAPABILITY_IDS.ANTHROPIC_MESSAGES,
    surface: 'anthropic_messages',
    auth_profiles: ['api_key', 'bearer'],
    package_name: '@ai-sdk/anthropic',
    package_version: ANTHROPIC_PACKAGE_VERSION,
    createLanguageModel(input) {
      const credential = requireAiSdkLanguageModelCredential(input);
      const provider = createAnthropic({
        baseURL: input.base_url,
        ...(input.headers ? { headers: input.headers } : {}),
        ...(credential.profile === 'api_key'
          ? { apiKey: credential.secret }
          : { authToken: credential.secret }),
        ...(input.fetch ? { fetch: input.fetch } : {}),
      });
      return provider.messages(input.endpoint_model_id);
    },
  },
};
