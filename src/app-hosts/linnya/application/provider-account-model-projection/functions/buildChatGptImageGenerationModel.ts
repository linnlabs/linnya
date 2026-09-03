import type { ModelConfig } from 'src/domains/model-catalog';
import type { ProviderAccountModelRuntimeBinding } from '../definitions/providerAccountModelProjection';

export const CHATGPT_IMAGE_GENERATION_MODEL_ID = 'chatgpt-subscription-gpt-image-2';
const CHATGPT_IMAGE_GENERATION_PROVIDER_MODEL_ID = 'gpt-image-2';

/**
 * Codex 内置图片工具使用同一账号身份请求 Codex backend 的 `/images/generations`。
 * 这里仅投影产品与 route 事实，不读取 OAuth token，也不把账号模型写入 Workspace。
 */
export function buildChatGptImageGenerationModel(
  accountId: string,
  binding: ProviderAccountModelRuntimeBinding
): ModelConfig {
  if (binding.auth_profile !== 'bearer') {
    throw new Error('ChatGPT 图片生成必须使用 bearer 账号认证');
  }
  return {
    id: CHATGPT_IMAGE_GENERATION_MODEL_ID,
    model_name: CHATGPT_IMAGE_GENERATION_PROVIDER_MODEL_ID,
    catalog_source: 'account',
    credential_reference: { kind: 'provider_account', account_id: accountId },
    capabilities: ['image_generation'],
    ui_visibility: ['image_generation'],
    // 账号模型直接展示 Provider 模型 ID；连接来源由模型选择器负责表达，避免维护易过期的本地别名。
    display_name: CHATGPT_IMAGE_GENERATION_PROVIDER_MODEL_ID,
    description: '使用当前 ChatGPT 订阅额度生成图片',
    image_generation_route: {
      api_surface: 'openai_images_generations',
      capability_id: 'ai-sdk:openai-compatible-image-generation',
      endpoint_id: binding.endpoint_id,
      endpoint_model_id: CHATGPT_IMAGE_GENERATION_PROVIDER_MODEL_ID,
      base_url: binding.default_base_url,
      auth_profile: 'bearer',
      response_format: 'b64_json',
      max_images_per_call: 1,
    },
    image_generation: {
      allowed_sizes: ['1024x1024', '1536x1024', '1024x1536'],
    },
  };
}
