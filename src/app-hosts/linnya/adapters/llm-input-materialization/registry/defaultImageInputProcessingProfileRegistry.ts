import { modelCatalog } from 'src/domains/model-catalog';
import { LANGUAGE_INFERENCE_CAPABILITY_IDS } from '@app/schemas/model-inference';
import { ANTHROPIC_MESSAGES_IMAGE_INPUT_PROFILE } from './anthropicMessagesImageInputProfile';
import { CHAT_COMPLETIONS_IMAGE_INPUT_PROFILE } from './chatCompletionsImageInputProfile';
import { DEEPSEEK_CHAT_IMAGE_INPUT_PROFILE } from './deepSeekChatImageInputProfile';
import { OLLAMA_CHAT_IMAGE_INPUT_PROFILE } from './ollamaChatImageInputProfile';
import { OPENAI_RESPONSES_IMAGE_INPUT_PROFILE } from './openAiResponsesImageInputProfile';
import { createImageInputProcessingProfileRegistry } from '../orchestration/createImageInputProcessingProfileRegistry';

/**
 * processing profile 与 typed converter 同批登记。
 *
 * 只有完成 typed converter、post-policy 门禁和 placement 的 route 才能登记。
 * 通用 Chat 两条 route 共用 profile；DeepSeek 虽使用同一 API surface，仍保留独立预算与限制。
 */
export const defaultImageInputProcessingProfileRegistry = createImageInputProcessingProfileRegistry(
  {
    resolveRouteForModel(activeModelId) {
      const config = modelCatalog.getModel(activeModelId);
      return config?.inference_route?.capability_id;
    },
    bindings: [
      {
        route: LANGUAGE_INFERENCE_CAPABILITY_IDS.OPENAI_CHAT,
        profile: CHAT_COMPLETIONS_IMAGE_INPUT_PROFILE,
      },
      {
        route: LANGUAGE_INFERENCE_CAPABILITY_IDS.OPENAI_COMPATIBLE_CHAT,
        profile: CHAT_COMPLETIONS_IMAGE_INPUT_PROFILE,
      },
      {
        route: LANGUAGE_INFERENCE_CAPABILITY_IDS.DEEPSEEK_CHAT,
        profile: DEEPSEEK_CHAT_IMAGE_INPUT_PROFILE,
      },
      {
        route: LANGUAGE_INFERENCE_CAPABILITY_IDS.OPENAI_RESPONSES,
        profile: OPENAI_RESPONSES_IMAGE_INPUT_PROFILE,
      },
      {
        route: LANGUAGE_INFERENCE_CAPABILITY_IDS.ANTHROPIC_MESSAGES,
        profile: ANTHROPIC_MESSAGES_IMAGE_INPUT_PROFILE,
      },
      {
        route: LANGUAGE_INFERENCE_CAPABILITY_IDS.OLLAMA_CHAT,
        profile: OLLAMA_CHAT_IMAGE_INPUT_PROFILE,
      },
    ],
  }
);
