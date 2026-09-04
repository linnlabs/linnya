import { z } from 'zod';

/**
 * 仅用于 language route 配置输入真正缺省容量的场景。
 * canonical route 经 schema 解析后始终携带明确容量；消费方不得再次补默认值。
 */
export const DEFAULT_LANGUAGE_CONTEXT_WINDOW_TOKENS = 256_000;
export const DEFAULT_LANGUAGE_MAX_OUTPUT_TOKENS = 16_384;
export const CHATGPT_CODEX_LANGUAGE_INFERENCE_ROUTE_PROFILE_ID = 'chatgpt_codex_responses';

export const LANGUAGE_INFERENCE_CAPABILITY_IDS = {
  MOCK: 'host:mock',
  OPENAI_CHAT: 'ai-sdk:openai-chat',
  OPENAI_COMPATIBLE_CHAT: 'ai-sdk:openai-compatible',
  OPENAI_RESPONSES: 'ai-sdk:openai-responses',
  ANTHROPIC_MESSAGES: 'ai-sdk:anthropic-messages',
  GOOGLE_GENERATIVE_AI: 'ai-sdk:google-generative-ai',
  DEEPSEEK_CHAT: 'ai-sdk:deepseek',
  MINIMAX_CHAT: 'ai-sdk:minimax',
  MOONSHOT_CHAT: 'ai-sdk:moonshotai',
  ALIBABA_CHAT: 'ai-sdk:alibaba',
  MISTRAL_CHAT: 'ai-sdk:mistral',
  XAI_RESPONSES: 'ai-sdk:xai-responses',
  GROQ_CHAT: 'ai-sdk:groq',
  CEREBRAS_CHAT: 'ai-sdk:cerebras',
  OPENROUTER_CHAT: 'ai-sdk:openrouter',
  FIREWORKS_CHAT: 'ai-sdk:fireworks',
  TOGETHERAI_CHAT: 'ai-sdk:togetherai',
  DEEPINFRA_CHAT: 'ai-sdk:deepinfra',
  COHERE_CHAT: 'ai-sdk:cohere',
  ZAI_CHAT: 'ai-sdk:zai',
  OLLAMA_CHAT: 'ai-sdk:ollama',
} as const;

export const LANGUAGE_INFERENCE_ROUTE_PROFILES = [
  {
    id: 'mock',
    api_surface: 'mock',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.MOCK,
    auth_profiles: ['none'],
    image_input_support: { user_image: true, tool_result_image: true },
  },
  {
    id: 'openai_chat',
    api_surface: 'openai_chat_completions',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.OPENAI_CHAT,
    auth_profiles: ['bearer'],
    image_input_support: { user_image: true, tool_result_image: false },
  },
  {
    id: 'openai_compatible_chat',
    api_surface: 'openai_chat_completions',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.OPENAI_COMPATIBLE_CHAT,
    auth_profiles: ['none', 'bearer'],
    image_input_support: { user_image: true, tool_result_image: false },
  },
  {
    id: 'openai_responses',
    api_surface: 'openai_responses',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.OPENAI_RESPONSES,
    auth_profiles: ['bearer'],
    image_input_support: { user_image: true, tool_result_image: true },
  },
  {
    /**
     * ChatGPT 订阅授权使用 Codex Responses 传输，但它不是 OpenAI API Key 产品。
     * 保留独立 route identity，避免账号授权、模型目录和请求 Header 被混入 OpenAI API 配置。
     */
    id: CHATGPT_CODEX_LANGUAGE_INFERENCE_ROUTE_PROFILE_ID,
    api_surface: 'openai_responses',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.OPENAI_RESPONSES,
    auth_profiles: ['bearer'],
    image_input_support: { user_image: true, tool_result_image: true },
  },
  {
    id: 'anthropic_messages',
    api_surface: 'anthropic_messages',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.ANTHROPIC_MESSAGES,
    auth_profiles: ['api_key', 'bearer'],
    image_input_support: { user_image: true, tool_result_image: true },
  },
  {
    id: 'google_generative_ai',
    api_surface: 'google_generative_ai',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.GOOGLE_GENERATIVE_AI,
    auth_profiles: ['api_key'],
    image_input_support: { user_image: true, tool_result_image: true },
  },
  {
    id: 'deepseek_chat',
    api_surface: 'openai_chat_completions',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.DEEPSEEK_CHAT,
    auth_profiles: ['bearer'],
    image_input_support: { user_image: true, tool_result_image: false },
  },
  {
    id: 'minimax_chat',
    api_surface: 'anthropic_messages',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.MINIMAX_CHAT,
    auth_profiles: ['api_key'],
    image_input_support: { user_image: true, tool_result_image: true },
  },
  {
    id: 'moonshot_chat',
    api_surface: 'openai_chat_completions',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.MOONSHOT_CHAT,
    auth_profiles: ['bearer'],
    image_input_support: { user_image: true, tool_result_image: false },
  },
  {
    id: 'alibaba_chat',
    api_surface: 'openai_chat_completions',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.ALIBABA_CHAT,
    auth_profiles: ['bearer'],
    image_input_support: { user_image: true, tool_result_image: false },
  },
  {
    id: 'mistral_chat',
    api_surface: 'openai_chat_completions',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.MISTRAL_CHAT,
    auth_profiles: ['bearer'],
    image_input_support: { user_image: true, tool_result_image: false },
  },
  {
    id: 'xai_responses',
    api_surface: 'openai_responses',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.XAI_RESPONSES,
    auth_profiles: ['bearer'],
    image_input_support: { user_image: true, tool_result_image: true },
  },
  {
    id: 'groq_chat',
    api_surface: 'openai_chat_completions',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.GROQ_CHAT,
    auth_profiles: ['bearer'],
    image_input_support: { user_image: true, tool_result_image: false },
  },
  {
    id: 'cerebras_chat',
    api_surface: 'openai_chat_completions',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.CEREBRAS_CHAT,
    auth_profiles: ['bearer'],
    image_input_support: { user_image: true, tool_result_image: false },
  },
  {
    id: 'openrouter_chat',
    api_surface: 'openai_chat_completions',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.OPENROUTER_CHAT,
    auth_profiles: ['bearer'],
    image_input_support: { user_image: true, tool_result_image: false },
  },
  {
    id: 'fireworks_chat',
    api_surface: 'openai_chat_completions',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.FIREWORKS_CHAT,
    auth_profiles: ['bearer'],
    image_input_support: { user_image: true, tool_result_image: false },
  },
  {
    id: 'togetherai_chat',
    api_surface: 'openai_chat_completions',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.TOGETHERAI_CHAT,
    auth_profiles: ['bearer'],
    image_input_support: { user_image: true, tool_result_image: false },
  },
  {
    id: 'deepinfra_chat',
    api_surface: 'openai_chat_completions',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.DEEPINFRA_CHAT,
    auth_profiles: ['bearer'],
    image_input_support: { user_image: true, tool_result_image: false },
  },
  {
    id: 'cohere_chat',
    api_surface: 'cohere_chat',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.COHERE_CHAT,
    auth_profiles: ['bearer'],
    image_input_support: { user_image: true, tool_result_image: false },
  },
  {
    id: 'zai_chat',
    api_surface: 'openai_chat_completions',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.ZAI_CHAT,
    auth_profiles: ['bearer'],
    image_input_support: { user_image: true, tool_result_image: false },
  },
  {
    id: 'ollama_chat',
    api_surface: 'ollama_chat',
    capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.OLLAMA_CHAT,
    auth_profiles: ['bearer'],
    image_input_support: { user_image: true, tool_result_image: true },
  },
] as const;

export type LanguageInferenceRouteProfile = (typeof LANGUAGE_INFERENCE_ROUTE_PROFILES)[number];
export type LanguageInferenceRouteProfileId = LanguageInferenceRouteProfile['id'];
export type InferenceApiSurface = LanguageInferenceRouteProfile['api_surface'];
export type InferenceAuthProfile = LanguageInferenceRouteProfile['auth_profiles'][number];

export const LanguageInferenceRouteProfileIdSchema = z.custom<LanguageInferenceRouteProfileId>(
  value =>
    typeof value === 'string' &&
    LANGUAGE_INFERENCE_ROUTE_PROFILES.some(profile => profile.id === value),
  '未知 language inference route profile'
);

const InferenceApiSurfaceSchema = z.enum([
  'mock',
  'openai_chat_completions',
  'openai_responses',
  'anthropic_messages',
  'google_generative_ai',
  'cohere_chat',
  'ollama_chat',
]);

const InferenceAuthProfileSchema = z.enum(['none', 'bearer', 'api_key']);
const LanguageInferenceCapabilityIdSchema = z.enum([
  LANGUAGE_INFERENCE_CAPABILITY_IDS.MOCK,
  LANGUAGE_INFERENCE_CAPABILITY_IDS.OPENAI_CHAT,
  LANGUAGE_INFERENCE_CAPABILITY_IDS.OPENAI_COMPATIBLE_CHAT,
  LANGUAGE_INFERENCE_CAPABILITY_IDS.OPENAI_RESPONSES,
  LANGUAGE_INFERENCE_CAPABILITY_IDS.ANTHROPIC_MESSAGES,
  LANGUAGE_INFERENCE_CAPABILITY_IDS.GOOGLE_GENERATIVE_AI,
  LANGUAGE_INFERENCE_CAPABILITY_IDS.DEEPSEEK_CHAT,
  LANGUAGE_INFERENCE_CAPABILITY_IDS.MINIMAX_CHAT,
  LANGUAGE_INFERENCE_CAPABILITY_IDS.MOONSHOT_CHAT,
  LANGUAGE_INFERENCE_CAPABILITY_IDS.ALIBABA_CHAT,
  LANGUAGE_INFERENCE_CAPABILITY_IDS.MISTRAL_CHAT,
  LANGUAGE_INFERENCE_CAPABILITY_IDS.XAI_RESPONSES,
  LANGUAGE_INFERENCE_CAPABILITY_IDS.GROQ_CHAT,
  LANGUAGE_INFERENCE_CAPABILITY_IDS.CEREBRAS_CHAT,
  LANGUAGE_INFERENCE_CAPABILITY_IDS.OPENROUTER_CHAT,
  LANGUAGE_INFERENCE_CAPABILITY_IDS.FIREWORKS_CHAT,
  LANGUAGE_INFERENCE_CAPABILITY_IDS.TOGETHERAI_CHAT,
  LANGUAGE_INFERENCE_CAPABILITY_IDS.DEEPINFRA_CHAT,
  LANGUAGE_INFERENCE_CAPABILITY_IDS.COHERE_CHAT,
  LANGUAGE_INFERENCE_CAPABILITY_IDS.ZAI_CHAT,
  LANGUAGE_INFERENCE_CAPABILITY_IDS.OLLAMA_CHAT,
]);

const CanonicalNonEmptyStringSchema = z.string().trim().min(1);
const CanonicalBaseUrlSchema = CanonicalNonEmptyStringSchema.transform(value =>
  value.replace(/\/+$/, '')
);

export const ModelInferenceRouteSchema = z
  .object({
    api_surface: InferenceApiSurfaceSchema,
    capability_id: LanguageInferenceCapabilityIdSchema,
    endpoint_id: CanonicalNonEmptyStringSchema,
    endpoint_model_id: CanonicalNonEmptyStringSchema,
    base_url: CanonicalBaseUrlSchema,
    auth_profile: InferenceAuthProfileSchema,
    context_window_tokens: z
      .number()
      .int('必须是正安全整数')
      .positive('必须是正安全整数')
      .safe('必须是正安全整数')
      .default(DEFAULT_LANGUAGE_CONTEXT_WINDOW_TOKENS),
    max_output_tokens: z
      .number()
      .int('必须是正安全整数')
      .positive('必须是正安全整数')
      .safe('必须是正安全整数')
      .default(DEFAULT_LANGUAGE_MAX_OUTPUT_TOKENS),
    input_support: z
      .object({
        user_image: z.boolean(),
        tool_result_image: z.boolean(),
      })
      .strict(),
    usage: z
      .object({
        response_usage: z.enum(['provider_reported_optional', 'unavailable']),
      })
      .strict(),
    continuation: z
      .object({
        tool_replay: z.enum(['required', 'optional', 'unavailable']),
      })
      .strict(),
  })
  .strict()
  .superRefine((route, context) => {
    const profile = LANGUAGE_INFERENCE_ROUTE_PROFILES.find(
      candidate =>
        candidate.api_surface === route.api_surface &&
        candidate.capability_id === route.capability_id
    );
    if (!profile) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['capability_id'],
        message: 'capability_id 与 api_surface 不是已启用的 route profile',
      });
      return;
    }
    if (!(profile.auth_profiles as readonly string[]).includes(route.auth_profile)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['auth_profile'],
        message: 'auth_profile 不属于该 route profile 的认证合同',
      });
    }
    if (route.input_support.user_image && !profile.image_input_support.user_image) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['input_support', 'user_image'],
        message: `${profile.id} route 不支持用户图片输入`,
      });
    }
    if (route.input_support.tool_result_image && !profile.image_input_support.tool_result_image) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['input_support', 'tool_result_image'],
        message: `${profile.id} route 不支持工具结果图片输入`,
      });
    }
  });

export type ModelInferenceRoute = z.infer<typeof ModelInferenceRouteSchema>;

export function parseModelInferenceRoute(value: unknown): ModelInferenceRoute {
  return ModelInferenceRouteSchema.parse(value);
}

export function findLanguageInferenceRouteProfile(
  profileId: LanguageInferenceRouteProfileId
): LanguageInferenceRouteProfile {
  const profile = LANGUAGE_INFERENCE_ROUTE_PROFILES.find(candidate => candidate.id === profileId);
  if (!profile) {
    throw new Error(`未知 language inference route profile: ${profileId}`);
  }
  return profile;
}

export function findLanguageInferenceRouteProfileForRoute(
  route: Pick<ModelInferenceRoute, 'api_surface' | 'capability_id'>
): LanguageInferenceRouteProfile {
  const profile = LANGUAGE_INFERENCE_ROUTE_PROFILES.find(
    candidate =>
      candidate.api_surface === route.api_surface && candidate.capability_id === route.capability_id
  );
  if (!profile) {
    throw new Error(
      `未注册的 language inference route profile: ${route.api_surface} / ${route.capability_id}`
    );
  }
  return profile;
}

export type LanguageInferenceImageInputSupport = ModelInferenceRoute['input_support'];

/**
 * 把模型自身的图片理解能力投影到某条已验收 route 的两个独立图片来源。
 *
 * 模型能力只回答“能否理解图片”，profile 只回答“当前 codec 能在哪个角色编码图片”；
 * 两者必须在这个边界相交，不能再用一个“完整视觉”布尔值把来源重新捆绑。
 */
export function projectLanguageInferenceImageInputSupport(
  profileId: LanguageInferenceRouteProfileId,
  modelSupportsImageInput: boolean
): LanguageInferenceImageInputSupport {
  const support = findLanguageInferenceRouteProfile(profileId).image_input_support;
  return {
    user_image: modelSupportsImageInput && support.user_image,
    tool_result_image: modelSupportsImageInput && support.tool_result_image,
  };
}

export interface BuildModelInferenceRouteInput {
  readonly profile_id: LanguageInferenceRouteProfileId;
  readonly endpoint_id: string;
  readonly endpoint_model_id: string;
  readonly base_url: string;
  readonly auth_profile: InferenceAuthProfile;
  readonly context_window_tokens?: number;
  readonly max_output_tokens?: number;
  readonly input_support: ModelInferenceRoute['input_support'];
  readonly usage: ModelInferenceRoute['usage'];
  readonly continuation: ModelInferenceRoute['continuation'];
}

export function buildModelInferenceRoute(
  input: BuildModelInferenceRouteInput
): ModelInferenceRoute {
  const profile = findLanguageInferenceRouteProfile(input.profile_id);
  return ModelInferenceRouteSchema.parse({
    api_surface: profile.api_surface,
    capability_id: profile.capability_id,
    endpoint_id: input.endpoint_id,
    endpoint_model_id: input.endpoint_model_id,
    base_url: input.base_url,
    auth_profile: input.auth_profile,
    context_window_tokens: input.context_window_tokens,
    max_output_tokens: input.max_output_tokens,
    input_support: input.input_support,
    usage: input.usage,
    continuation: input.continuation,
  });
}
