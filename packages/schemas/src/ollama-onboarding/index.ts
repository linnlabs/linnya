import { z } from 'zod';

const NonEmptyStringSchema = z.string().trim().min(1);
const PositiveSafeIntegerSchema = z.number().int().positive().safe();

/** Ollama 表单填写服务根地址；允许本机、内网和远程 HTTP(S)，统一移除尾部斜杠。 */
export function normalizeOllamaServiceUrl(value: string): string | undefined {
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

const OllamaServiceUrlSchema = NonEmptyStringSchema.transform((value, context) => {
  const normalized = normalizeOllamaServiceUrl(value);
  if (normalized) return normalized;
  context.addIssue({ code: z.ZodIssueCode.custom, message: '必须是 HTTP 或 HTTPS 服务地址' });
  return z.NEVER;
});

export const OLLAMA_ONBOARDING_ERROR_CODES = [
  'ollama_onboarding.invalid_command',
  'ollama_onboarding.provider_not_found',
  'ollama_onboarding.provider_not_supported',
  'ollama_onboarding.configuration_mismatch',
  'ollama_onboarding.registration_failed',
] as const;

/** Renderer 只提交用户事实；route、endpoint identity 与 Provider 归属由 Host 构造。 */
export const OllamaModelRegistrationCommandSchema = z
  .object({
    provider_connection_definition_id: NonEmptyStringSchema,
    service_url: OllamaServiceUrlSchema,
    endpoint_model_id: NonEmptyStringSchema,
    display_name: NonEmptyStringSchema.optional(),
    context_window_tokens: PositiveSafeIntegerSchema,
    max_output_tokens: PositiveSafeIntegerSchema,
  })
  .strict();

export const OllamaModelRegistrationResponseSchema = z
  .object({
    model_id: NonEmptyStringSchema,
    provider_definition_id: NonEmptyStringSchema,
    provider_connection_definition_id: NonEmptyStringSchema,
    provider_model_id: NonEmptyStringSchema,
  })
  .strict();

export const OllamaOnboardingErrorResponseSchema = z
  .object({
    code: z.enum(OLLAMA_ONBOARDING_ERROR_CODES),
    message: NonEmptyStringSchema,
  })
  .strict();

export type OllamaModelRegistrationCommand = z.infer<typeof OllamaModelRegistrationCommandSchema>;
export type OllamaModelRegistrationResponse = z.infer<typeof OllamaModelRegistrationResponseSchema>;
export type OllamaOnboardingErrorCode = (typeof OLLAMA_ONBOARDING_ERROR_CODES)[number];
export type OllamaOnboardingErrorResponse = z.infer<typeof OllamaOnboardingErrorResponseSchema>;
