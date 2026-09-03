import { z } from 'zod';

const NonEmptyStringSchema = z.string().trim().min(1);

export const PROVIDER_ONBOARDING_ERROR_CODES = [
  'provider_onboarding.invalid_command',
  'provider_onboarding.catalog_generation_mismatch',
  'provider_onboarding.provider_not_found',
  'provider_onboarding.provider_not_supported',
  'provider_onboarding.model_not_found',
  'provider_onboarding.runtime_binding_missing',
  'provider_onboarding.configuration_invalid',
  'provider_onboarding.model_already_registered',
  'provider_onboarding.credential_required',
  'provider_onboarding.authorization_required',
  'provider_onboarding.registration_failed',
] as const;

/** Renderer 提交正式 Provider 模型时唯一允许的公开 command。 */
export const DirectProviderModelRegistrationCommandSchema = z
  .object({
    provider_connection_definition_id: NonEmptyStringSchema,
    provider_model_id: NonEmptyStringSchema,
    api_key: NonEmptyStringSchema.optional(),
    display_name: NonEmptyStringSchema.optional(),
  })
  .strict();

export const DirectProviderModelRegistrationResponseSchema = z
  .object({
    model_id: NonEmptyStringSchema,
    provider_definition_id: NonEmptyStringSchema,
    provider_connection_definition_id: NonEmptyStringSchema,
    provider_model_id: NonEmptyStringSchema,
  })
  .strict();

/** Renderer 首次连接直连 Provider 时只提交连接身份和密钥。 */
export const DirectProviderConnectionOnboardingCommandSchema = z
  .object({
    provider_connection_definition_id: NonEmptyStringSchema,
    api_key: NonEmptyStringSchema,
  })
  .strict();

export const DirectProviderConnectionOnboardingResponseSchema = z
  .object({
    provider_definition_id: NonEmptyStringSchema,
    provider_connection_definition_id: NonEmptyStringSchema,
    model_ids: z.array(NonEmptyStringSchema).min(1),
  })
  .strict();

export const ProviderOnboardingErrorResponseSchema = z
  .object({
    code: z.enum(PROVIDER_ONBOARDING_ERROR_CODES),
    message: NonEmptyStringSchema,
  })
  .strict();

export type DirectProviderModelRegistrationCommand = z.infer<
  typeof DirectProviderModelRegistrationCommandSchema
>;
export type DirectProviderModelRegistrationResponse = z.infer<
  typeof DirectProviderModelRegistrationResponseSchema
>;
export type DirectProviderConnectionOnboardingCommand = z.infer<
  typeof DirectProviderConnectionOnboardingCommandSchema
>;
export type DirectProviderConnectionOnboardingResponse = z.infer<
  typeof DirectProviderConnectionOnboardingResponseSchema
>;
export type ProviderOnboardingErrorCode = (typeof PROVIDER_ONBOARDING_ERROR_CODES)[number];
export type ProviderOnboardingErrorResponse = z.infer<typeof ProviderOnboardingErrorResponseSchema>;
