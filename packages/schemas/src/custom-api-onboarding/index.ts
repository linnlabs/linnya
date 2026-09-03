import { z } from 'zod';
import {
  projectLanguageInferenceImageInputSupport,
  type LanguageInferenceImageInputSupport,
  type LanguageInferenceRouteProfileId,
} from '../model-inference';

const NonEmptyStringSchema = z.string().trim().min(1);
const PositiveSafeIntegerSchema = z.number().int().positive().safe();

export const CUSTOM_API_FORMAT_DEFINITIONS = [
  { id: 'openai_compatible', route_profile_id: 'openai_compatible_chat' },
  { id: 'openai_responses', route_profile_id: 'openai_responses' },
  { id: 'anthropic_compatible', route_profile_id: 'anthropic_messages' },
] as const;

export type CustomApiFormat = (typeof CUSTOM_API_FORMAT_DEFINITIONS)[number]['id'];

export const CustomApiFormatSchema = z.enum([
  'openai_compatible',
  'openai_responses',
  'anthropic_compatible',
]);

/** 自定义 API 允许 HTTPS、公司内网 HTTP 与本机 HTTP，并统一去掉末尾斜杠。 */
export function normalizeCustomApiBaseUrl(value: string): string | undefined {
  const candidate = value.trim();
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  return candidate.replace(/\/+$/, '');
}

export const CustomApiBaseUrlSchema = NonEmptyStringSchema.transform((value, context) => {
  const normalized = normalizeCustomApiBaseUrl(value);
  if (normalized) return normalized;
  context.addIssue({ code: z.ZodIssueCode.custom, message: '必须是 HTTP 或 HTTPS API 地址' });
  return z.NEVER;
});

export const CUSTOM_API_ONBOARDING_ERROR_CODES = [
  'custom_api_onboarding.invalid_command',
  'custom_api_onboarding.credential_required',
  'custom_api_onboarding.registration_failed',
] as const;

/** 自定义 API 只提交用户能理解并显式填写的事实，不承载内部 route 或 Provider 字段。 */
export const CustomApiModelRegistrationCommandSchema = z
  .object({
    api_format: CustomApiFormatSchema,
    base_url: CustomApiBaseUrlSchema,
    api_key: NonEmptyStringSchema.optional(),
    endpoint_model_id: NonEmptyStringSchema,
    display_name: NonEmptyStringSchema.optional(),
    context_window_tokens: PositiveSafeIntegerSchema,
    max_output_tokens: PositiveSafeIntegerSchema,
    supports_image_input: z.boolean(),
  })
  .strict();

export const CustomApiModelRegistrationResponseSchema = z
  .object({ model_id: NonEmptyStringSchema })
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
  const definition = CUSTOM_API_FORMAT_DEFINITIONS.find(candidate => candidate.id === format);
  if (!definition) throw new Error(`未知自定义 API 格式: ${format}`);
  return definition.route_profile_id;
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

export type CustomApiModelRegistrationCommand = z.infer<
  typeof CustomApiModelRegistrationCommandSchema
>;
export type CustomApiModelRegistrationResponse = z.infer<
  typeof CustomApiModelRegistrationResponseSchema
>;
export type CustomApiOnboardingErrorCode = (typeof CUSTOM_API_ONBOARDING_ERROR_CODES)[number];
export type CustomApiOnboardingErrorResponse = z.infer<
  typeof CustomApiOnboardingErrorResponseSchema
>;
