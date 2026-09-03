import { createGoogle, VERSION as GOOGLE_PACKAGE_VERSION } from '@ai-sdk/google';
import {
  AI_SDK_INFERENCE_CAPABILITY_IDS,
} from '../../definitions/aiSdkCapabilityIds';
import type { AiSdkLanguageModelFactoryEntry } from '../../definitions/aiSdkInferenceSurface';
import { requireAiSdkLanguageModelCredential } from '../../functions/requireAiSdkLanguageModelCredential';

export const GOOGLE_LANGUAGE_MODEL_FACTORIES: Record<
  typeof AI_SDK_INFERENCE_CAPABILITY_IDS.GOOGLE_GENERATIVE_AI,
  AiSdkLanguageModelFactoryEntry
> = {
  [AI_SDK_INFERENCE_CAPABILITY_IDS.GOOGLE_GENERATIVE_AI]: {
    capability_id: AI_SDK_INFERENCE_CAPABILITY_IDS.GOOGLE_GENERATIVE_AI,
    surface: 'google_generative_ai',
    auth_profiles: ['api_key'],
    package_name: '@ai-sdk/google',
    package_version: GOOGLE_PACKAGE_VERSION,
    createLanguageModel(input) {
      const credential = requireAiSdkLanguageModelCredential(input);
      const provider = createGoogle({
        baseURL: input.base_url,
        apiKey: credential.secret,
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.fetch ? { fetch: input.fetch } : {}),
      });
      return provider.languageModel(input.endpoint_model_id);
    },
  },
};
