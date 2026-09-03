import { createXai, VERSION as XAI_PACKAGE_VERSION } from '@ai-sdk/xai';
import {
  AI_SDK_INFERENCE_CAPABILITY_IDS,
} from '../../definitions/aiSdkCapabilityIds';
import type { AiSdkLanguageModelFactoryEntry } from '../../definitions/aiSdkInferenceSurface';
import { requireAiSdkLanguageModelCredential } from '../../functions/requireAiSdkLanguageModelCredential';

export const XAI_LANGUAGE_MODEL_FACTORIES: Record<
  typeof AI_SDK_INFERENCE_CAPABILITY_IDS.XAI_RESPONSES,
  AiSdkLanguageModelFactoryEntry
> = {
  [AI_SDK_INFERENCE_CAPABILITY_IDS.XAI_RESPONSES]: {
    capability_id: AI_SDK_INFERENCE_CAPABILITY_IDS.XAI_RESPONSES,
    surface: 'openai_responses',
    auth_profiles: ['bearer'],
    package_name: '@ai-sdk/xai',
    package_version: XAI_PACKAGE_VERSION,
    createLanguageModel(input) {
      const credential = requireAiSdkLanguageModelCredential(input);
      const provider = createXai({
        baseURL: input.base_url,
        apiKey: credential.secret,
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.fetch ? { fetch: input.fetch } : {}),
      });
      return provider.responses(input.endpoint_model_id);
    },
  },
};
