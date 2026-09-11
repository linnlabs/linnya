import { z } from 'zod';
import {
  projectLanguageInferenceImageInputSupport,
  type LanguageInferenceImageInputSupport,
  type LanguageInferenceRouteProfileId,
} from '../model-inference';

const NonEmptyStringSchema = z.string().trim().min(1);
const PositiveSafeIntegerSchema = z.number().int().positive().safe();

export const CUSTOM_API_FORMAT_DEFINITIONS = [
  {
    id: 'openai_compatible',
    route_profile_id: 'openai_compatible_chat',
    default_base_path: '/v1',
  },
  { id: 'openai_responses', route_profile_id: 'openai_responses', default_base_path: '/v1' },
  {
    id: 'anthropic_compatible',
    route_profile_id: 'anthropic_messages',
    default_base_path: '/v1',
  },
] as const;

export type CustomApiFormat = (typeof CUSTOM_API_FORMAT_DEFINITIONS)[number]['id'];

export const CustomApiFormatSchema = z.enum([
  'openai_compatible',
  'openai_responses',
  'anthropic_compatible',
]);

function readCustomApiFormatDefinition(format: CustomApiFormat) {
  const definition = CUSTOM_API_FORMAT_DEFINITIONS.find(candidate => candidate.id === format);
  if (!definition) throw new Error(`未知自定义 API 格式: ${format}`);
  return definition;
}

/**
 * 自定义 API 允许 HTTPS、公司内网 HTTP 与本机 HTTP。
 * 纯域名沿用所选 wire 协议的默认基线路径；用户显式填写的网关路径必须原样保留。
 */
export function normalizeCustomApiBaseUrl(
  format: CustomApiFormat,
  value: string
): string | undefined {
  const candidate = value.trim();
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.pathname === '/') {
    url.pathname = readCustomApiFormatDefinition(format).default_base_path;
  } else {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.toString().replace(/\/$/, '');
}

export const CUSTOM_API_ONBOARDING_ERROR_CODES = [
  'custom_api_onboarding.invalid_command',
  'custom_api_onboarding.credential_required',
  'custom_api_onboarding.registration_failed',
] as const;

export const CustomApiModelItemSchema = z
  .object({
    endpoint_model_id: NonEmptyStringSchema,
    display_name: NonEmptyStringSchema.optional(),
    context_window_tokens: PositiveSafeIntegerSchema,
    max_output_tokens: PositiveSafeIntegerSchema,
    supports_image_input: z.boolean(),
    picker_enabled: z.boolean().optional(),
  })
  .strict();

export type CustomApiModelItem = z.infer<typeof CustomApiModelItemSchema>;

/** 从 base_url 中提取默认的 provider 标识，例如 http://xiaoxiao.work.gd/v1 -> xiaoxiao.work.gd */
export function extractDefaultProviderNameFromBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl.trim());
    return url.hostname || 'custom';
  } catch {
    return 'custom';
  }
}

/** 自定义 API 只提交用户能理解并显式填写的事实，不承载内部 route 或 Provider 字段。 */
export const CustomApiModelRegistrationCommandSchema = z
  .object({
    provider_name: NonEmptyStringSchema.optional(),
    api_format: CustomApiFormatSchema,
    base_url: NonEmptyStringSchema,
    api_key: NonEmptyStringSchema.optional(),
    endpoint_model_id: NonEmptyStringSchema.optional(),
    display_name: NonEmptyStringSchema.optional(),
    context_window_tokens: PositiveSafeIntegerSchema.optional(),
    max_output_tokens: PositiveSafeIntegerSchema.optional(),
    supports_image_input: z.boolean().optional(),
    models: z.array(CustomApiModelItemSchema).optional(),
  })
  .strict()
  .transform((command, context) => {
    const baseUrl = normalizeCustomApiBaseUrl(command.api_format, command.base_url);
    if (!baseUrl) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['base_url'],
        message: '必须是 HTTP 或 HTTPS API 地址',
      });
      return z.NEVER;
    }
    let models: [CustomApiModelItem, ...CustomApiModelItem[]];
    const batchModels = command.models;
    const firstBatchModel = batchModels?.[0];
    if (batchModels && firstBatchModel) {
      models = [firstBatchModel, ...batchModels.slice(1)];
    } else if (
      command.endpoint_model_id !== undefined &&
      command.context_window_tokens !== undefined &&
      command.max_output_tokens !== undefined &&
      command.supports_image_input !== undefined
    ) {
      models = [
        {
          endpoint_model_id: command.endpoint_model_id,
          context_window_tokens: command.context_window_tokens,
          max_output_tokens: command.max_output_tokens,
          supports_image_input: command.supports_image_input,
          ...(command.display_name ? { display_name: command.display_name } : {}),
        },
      ];
    } else {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['models'],
        message: '必须提供单一模型配置或非空模型列表',
      });
      return z.NEVER;
    }

    const providerName = command.provider_name ?? extractDefaultProviderNameFromBaseUrl(baseUrl);

    return {
      api_format: command.api_format,
      base_url: baseUrl,
      provider_name: providerName,
      ...(command.api_key ? { api_key: command.api_key } : {}),
      models,
    };
  });

export const CustomApiModelRegistrationResponseSchema = z
  .object({
    model_id: NonEmptyStringSchema.optional(),
    model_ids: z.array(NonEmptyStringSchema).optional(),
  })
  .strict();

export const CustomApiOnboardingErrorResponseSchema = z
  .object({
    code: z.enum(CUSTOM_API_ONBOARDING_ERROR_CODES),
    message: NonEmptyStringSchema,
  })
  .strict();

export function readCustomApiFormatRouteProfileId(
  format: CustomApiFormat
): LanguageInferenceRouteProfileId {
  return readCustomApiFormatDefinition(format).route_profile_id;
}

/** 自定义模型只声明语义能力，API 格式负责决定两个图片来源能否真正进入 route。 */
export function projectCustomApiFormatImageInputSupport(
  format: CustomApiFormat,
  modelSupportsImageInput: boolean
): LanguageInferenceImageInputSupport {
  return projectLanguageInferenceImageInputSupport(
    readCustomApiFormatRouteProfileId(format),
    modelSupportsImageInput
  );
}

/** Renderer 与 HTTP client 提交的 wire request；默认 provider 等事实由 Host admission 补齐。 */
export type CustomApiModelRegistrationRequest = z.input<
  typeof CustomApiModelRegistrationCommandSchema
>;

/** Schema admission 后的规范化命令；Host 只处理非空模型列表。 */
export type CustomApiModelRegistrationCommand = z.output<
  typeof CustomApiModelRegistrationCommandSchema
>;
export type CustomApiModelRegistrationResponse = z.infer<
  typeof CustomApiModelRegistrationResponseSchema
>;
export type CustomApiOnboardingErrorCode = (typeof CUSTOM_API_ONBOARDING_ERROR_CODES)[number];
export type CustomApiOnboardingErrorResponse = z.infer<
  typeof CustomApiOnboardingErrorResponseSchema
>;
