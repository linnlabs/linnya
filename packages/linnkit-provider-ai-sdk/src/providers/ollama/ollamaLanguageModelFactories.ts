import { createOllama } from 'ai-sdk-ollama';
import adapterPackage from '../../../package.json' with { type: 'json' };
import { AI_SDK_INFERENCE_CAPABILITY_IDS } from '../../definitions/aiSdkCapabilityIds';
import type { AiSdkLanguageModelFactoryEntry } from '../../definitions/aiSdkInferenceSurface';
import { requireAiSdkLanguageModelCredential } from '../../functions/requireAiSdkLanguageModelCredential';

export const OLLAMA_LANGUAGE_MODEL_FACTORIES: Record<
  typeof AI_SDK_INFERENCE_CAPABILITY_IDS.OLLAMA_CHAT,
  AiSdkLanguageModelFactoryEntry
> = {
  [AI_SDK_INFERENCE_CAPABILITY_IDS.OLLAMA_CHAT]: {
    capability_id: AI_SDK_INFERENCE_CAPABILITY_IDS.OLLAMA_CHAT,
    surface: 'ollama_chat',
    auth_profiles: ['bearer'],
    package_name: 'ai-sdk-ollama',
    package_version: adapterPackage.dependencies['ai-sdk-ollama'],
    createLanguageModel(input) {
      const credential = requireAiSdkLanguageModelCredential(input);
      const provider = createOllama({
        baseURL: input.base_url,
        apiKey: credential.secret,
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.fetch ? { fetch: input.fetch } : {}),
      });
      return provider.chat(input.endpoint_model_id, {
        // Linnkit 独占重试与 Agent 循环；Provider 不得在一次 attempt 内暗中追加请求。
        reliableToolCalling: false,
        reliableObjectGeneration: false,
      });
    },
  },
};
