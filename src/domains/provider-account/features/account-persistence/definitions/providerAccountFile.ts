import type {
  ProviderAccount,
  ProviderAccountOAuthCredential,
} from '../../../definitions/providerAccount';
import { projectLegacyProviderConnectionIdentity } from '@app/schemas/provider-catalog';

export const PROVIDER_ACCOUNT_FILE_VERSION = '2.0.0';

export interface StoredProviderAccount extends ProviderAccount {
  readonly encrypted_credential: string;
}

export interface ProviderAccountFile {
  readonly version: typeof PROVIDER_ACCOUNT_FILE_VERSION;
  readonly last_updated: string;
  readonly accounts: readonly StoredProviderAccount[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${context}.${key} 必须是非空字符串`);
  }
  return value;
}

export function readProviderAccountFile(value: unknown): readonly StoredProviderAccount[] {
  if (!isRecord(value) || value.version !== PROVIDER_ACCOUNT_FILE_VERSION) {
    throw new Error(`provider_accounts.json version 必须是 ${PROVIDER_ACCOUNT_FILE_VERSION}`);
  }
  if (typeof value.last_updated !== 'string' || !Array.isArray(value.accounts)) {
    throw new Error('provider_accounts.json envelope 无效');
  }
  return value.accounts.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`provider_accounts.json.accounts[${index}] 必须是对象`);
    }
    const context = `provider_accounts.json.accounts[${index}]`;
    if (entry.auth_method !== 'oauth_pkce') {
      throw new Error(`${context}.auth_method 无效`);
    }
    return {
      id: readRequiredString(entry, 'id', context),
      provider_connection_definition_id: readRequiredString(
        entry,
        'provider_connection_definition_id',
        context
      ),
      auth_method: entry.auth_method,
      created_at: readRequiredString(entry, 'created_at', context),
      updated_at: readRequiredString(entry, 'updated_at', context),
      encrypted_credential: readRequiredString(entry, 'encrypted_credential', context),
    };
  });
}

/** v1 的账号只保存旧产品 ID；v2 精确改为账号型 connection ID。 */
export function migrateProviderAccountFileV1(
  value: unknown
): readonly StoredProviderAccount[] | undefined {
  if (!isRecord(value) || value.version !== '1.0.0') return undefined;
  if (typeof value.last_updated !== 'string' || !Array.isArray(value.accounts)) {
    throw new Error('provider_accounts.json envelope 无效');
  }
  return value.accounts.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`provider_accounts.json.accounts[${index}] 必须是对象`);
    }
    const context = `provider_accounts.json.accounts[${index}]`;
    if (entry.auth_method !== 'oauth_pkce') {
      throw new Error(`${context}.auth_method 无效`);
    }
    const legacyProviderDefinitionId = readRequiredString(entry, 'provider_definition_id', context);
    return {
      id: readRequiredString(entry, 'id', context),
      provider_connection_definition_id: projectLegacyProviderConnectionIdentity(
        legacyProviderDefinitionId
      ).provider_connection_definition_id,
      auth_method: entry.auth_method,
      created_at: readRequiredString(entry, 'created_at', context),
      updated_at: readRequiredString(entry, 'updated_at', context),
      encrypted_credential: readRequiredString(entry, 'encrypted_credential', context),
    };
  });
}

export function readProviderAccountOAuthCredential(value: unknown): ProviderAccountOAuthCredential {
  if (!isRecord(value)) throw new Error('Provider account OAuth credential 必须是对象');
  const accessToken = readRequiredString(
    value,
    'access_token',
    'Provider account OAuth credential'
  );
  const refreshToken = readRequiredString(
    value,
    'refresh_token',
    'Provider account OAuth credential'
  );
  const accountId = readRequiredString(value, 'account_id', 'Provider account OAuth credential');
  if (typeof value.expires_at !== 'number' || !Number.isSafeInteger(value.expires_at)) {
    throw new Error('Provider account OAuth credential.expires_at 必须是安全整数');
  }
  const idToken = value.id_token;
  const email = value.email;
  if (idToken !== undefined && (typeof idToken !== 'string' || !idToken)) {
    throw new Error('Provider account OAuth credential.id_token 无效');
  }
  if (email !== undefined && (typeof email !== 'string' || !email)) {
    throw new Error('Provider account OAuth credential.email 无效');
  }
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: value.expires_at,
    account_id: accountId,
    ...(idToken ? { id_token: idToken } : {}),
    ...(email ? { email } : {}),
  };
}
