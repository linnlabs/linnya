import { z } from 'zod';

const NonEmptyStringSchema = z.string().trim().min(1);

export const PROVIDER_ACCOUNT_AUTHORIZATION_ERROR_CODES = [
  'provider_account.authorization_in_progress',
  'provider_account.callback_unavailable',
  'provider_account.authorization_cancelled',
  'provider_account.authorization_expired',
  'provider_account.token_exchange_failed',
  'provider_account.credential_persistence_failed',
  'provider_account.model_synchronization_failed',
] as const;

export const ProviderAccountAuthorizationResponseSchema = z
  .object({
    account_id: NonEmptyStringSchema,
    provider_connection_definition_id: NonEmptyStringSchema,
    status: z.literal('connected'),
  })
  .strict();

export const ProviderAccountAuthorizationStatusResponseSchema = z
  .object({
    account_id: NonEmptyStringSchema,
    provider_connection_definition_id: NonEmptyStringSchema,
    status: z.enum(['connected', 'disconnected']),
  })
  .strict();

export const ProviderAccountAuthorizationErrorResponseSchema = z
  .object({
    code: z.enum(PROVIDER_ACCOUNT_AUTHORIZATION_ERROR_CODES),
    message: NonEmptyStringSchema,
  })
  .strict();

export type ProviderAccountAuthorizationResponse = z.infer<
  typeof ProviderAccountAuthorizationResponseSchema
>;
export type ProviderAccountAuthorizationStatusResponse = z.infer<
  typeof ProviderAccountAuthorizationStatusResponseSchema
>;
export type ProviderAccountAuthorizationErrorCode =
  (typeof PROVIDER_ACCOUNT_AUTHORIZATION_ERROR_CODES)[number];
export type ProviderAccountAuthorizationErrorResponse = z.infer<
  typeof ProviderAccountAuthorizationErrorResponseSchema
>;
