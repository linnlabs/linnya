import type { AiSdkInferenceCapabilityId } from '../definitions/aiSdkCapabilityIds';
import type {
  AiSdkLanguageModelFactoryEntry,
  AiSdkLanguageModelFactoryInput,
  AiSdkLanguageModelRegistry,
} from '../definitions/aiSdkInferenceSurface';
import { ANTHROPIC_LANGUAGE_MODEL_FACTORIES } from '../providers/anthropic/anthropicLanguageModelFactories';
import { ALIBABA_LANGUAGE_MODEL_FACTORIES } from '../providers/alibaba/alibabaLanguageModelFactories';
import { CEREBRAS_LANGUAGE_MODEL_FACTORIES } from '../providers/cerebras/cerebrasLanguageModelFactories';
import { COHERE_LANGUAGE_MODEL_FACTORIES } from '../providers/cohere/cohereLanguageModelFactories';
import { OPENAI_COMPATIBLE_LANGUAGE_MODEL_FACTORIES } from '../providers/compatible/openAiCompatibleLanguageModelFactories';
import { DEEPINFRA_LANGUAGE_MODEL_FACTORIES } from '../providers/deepinfra/deepInfraLanguageModelFactories';
import { DEEPSEEK_LANGUAGE_MODEL_FACTORIES } from '../providers/deepseek/deepSeekLanguageModelFactories';
import { FIREWORKS_LANGUAGE_MODEL_FACTORIES } from '../providers/fireworks/fireworksLanguageModelFactories';
import { GOOGLE_LANGUAGE_MODEL_FACTORIES } from '../providers/google/googleLanguageModelFactories';
import { GROQ_LANGUAGE_MODEL_FACTORIES } from '../providers/groq/groqLanguageModelFactories';
import { MINIMAX_LANGUAGE_MODEL_FACTORIES } from '../providers/minimax/miniMaxLanguageModelFactories';
import { MISTRAL_LANGUAGE_MODEL_FACTORIES } from '../providers/mistral/mistralLanguageModelFactories';
import { MOONSHOT_LANGUAGE_MODEL_FACTORIES } from '../providers/moonshot/moonshotLanguageModelFactories';
import { OPENAI_LANGUAGE_MODEL_FACTORIES } from '../providers/openai/openAiLanguageModelFactories';
import { OPENROUTER_LANGUAGE_MODEL_FACTORIES } from '../providers/openrouter/openRouterLanguageModelFactories';
import { TOGETHERAI_LANGUAGE_MODEL_FACTORIES } from '../providers/togetherai/togetherAiLanguageModelFactories';
import { XAI_LANGUAGE_MODEL_FACTORIES } from '../providers/xai/xAiLanguageModelFactories';
import { ZAI_LANGUAGE_MODEL_FACTORIES } from '../providers/zai/zaiLanguageModelFactories';

const AI_SDK_LANGUAGE_MODEL_FACTORIES = {
  ...OPENAI_LANGUAGE_MODEL_FACTORIES,
  ...OPENAI_COMPATIBLE_LANGUAGE_MODEL_FACTORIES,
  ...ANTHROPIC_LANGUAGE_MODEL_FACTORIES,
  ...GOOGLE_LANGUAGE_MODEL_FACTORIES,
  ...DEEPSEEK_LANGUAGE_MODEL_FACTORIES,
  ...MINIMAX_LANGUAGE_MODEL_FACTORIES,
  ...MOONSHOT_LANGUAGE_MODEL_FACTORIES,
  ...ALIBABA_LANGUAGE_MODEL_FACTORIES,
  ...MISTRAL_LANGUAGE_MODEL_FACTORIES,
  ...XAI_LANGUAGE_MODEL_FACTORIES,
  ...GROQ_LANGUAGE_MODEL_FACTORIES,
  ...CEREBRAS_LANGUAGE_MODEL_FACTORIES,
  ...OPENROUTER_LANGUAGE_MODEL_FACTORIES,
  ...FIREWORKS_LANGUAGE_MODEL_FACTORIES,
  ...TOGETHERAI_LANGUAGE_MODEL_FACTORIES,
  ...DEEPINFRA_LANGUAGE_MODEL_FACTORIES,
  ...COHERE_LANGUAGE_MODEL_FACTORIES,
  ...ZAI_LANGUAGE_MODEL_FACTORIES,
} satisfies Record<AiSdkInferenceCapabilityId, AiSdkLanguageModelFactoryEntry>;

const FACTORY_ENTRIES: readonly AiSdkLanguageModelFactoryEntry[] = Object.freeze(
  Object.values(AI_SDK_LANGUAGE_MODEL_FACTORIES)
);

const FACTORIES_BY_CAPABILITY = new Map(
  FACTORY_ENTRIES.map(entry => [entry.capability_id, entry] as const)
);

export function createAiSdkLanguageModelRegistry(
  fetch?: AiSdkLanguageModelFactoryInput['fetch']
): AiSdkLanguageModelRegistry {
  return {
    entries: FACTORY_ENTRIES,
    languageModel(input) {
      const attemptInput = { ...input, ...(fetch ? { fetch } : {}) };
      const entry = FACTORIES_BY_CAPABILITY.get(attemptInput.capability_id);
      if (!entry) {
        throw new Error(
          `[AiSdkInference] 未注册 Provider package factory: ${attemptInput.capability_id}`
        );
      }
      if (entry.surface !== attemptInput.surface) {
        throw new Error(
          `[AiSdkInference] ${entry.capability_id} capability 与 ${attemptInput.surface} surface 不一致。`
        );
      }
      const authProfile = attemptInput.credential?.profile ?? 'none';
      if (!entry.auth_profiles.includes(authProfile)) {
        throw new Error(
          `[AiSdkInference] ${entry.capability_id} capability 不接受 ${authProfile} 凭据。`
        );
      }
      return entry.createLanguageModel(attemptInput);
    },
  };
}
