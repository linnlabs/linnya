import { z } from 'zod';
import { CredentialStorageError } from 'src/shared/credential-storage';

const requiredString = z.string().min(1);
const OAuthCredentialSchema = z
  .object({
    access_token: requiredString,
    refresh_token: requiredString,
    expires_at: z.number().int().safe(),
    account_id: requiredString,
    id_token: requiredString.optional(),
    email: requiredString.optional(),
  })
  .strict();

const StoredProviderAccountSchema = z
  .object({
    account: z
      .object({
        id: requiredString,
        provider_connection_definition_id: requiredString,
        auth_method: z.literal('oauth_pkce'),
        created_at: requiredString,
        updated_at: requiredString,
      })
      .strict(),
    credential: OAuthCredentialSchema,
  })
  .strict();

export type StoredProviderAccount = z.infer<typeof StoredProviderAccountSchema>;

export function readStoredProviderAccount(value: unknown): StoredProviderAccount {
  const parsed = StoredProviderAccountSchema.safeParse(value);
  // 不向日志/Renderer 传递 Zod 的原始输入或 token 内容。
  if (!parsed.success) throw new CredentialStorageError('invalid_format');
  return parsed.data;
}
