import type { ProviderAccountOAuthCredential } from '../../../definitions/providerAccount';

interface ChatGptJwtClaims {
  readonly chatgpt_account_id?: string;
  readonly email?: string;
  readonly organizations?: readonly { readonly id?: string }[];
  readonly 'https://api.openai.com/auth'?: {
    readonly chatgpt_account_id?: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJwtClaims(token: string): ChatGptJwtClaims | undefined {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!isRecord(parsed)) return undefined;
    const nested = parsed['https://api.openai.com/auth'];
    const organizations = parsed.organizations;
    return {
      ...(typeof parsed.chatgpt_account_id === 'string'
        ? { chatgpt_account_id: parsed.chatgpt_account_id }
        : {}),
      ...(typeof parsed.email === 'string' ? { email: parsed.email } : {}),
      ...(isRecord(nested) && typeof nested.chatgpt_account_id === 'string'
        ? {
            'https://api.openai.com/auth': {
              chatgpt_account_id: nested.chatgpt_account_id,
            },
          }
        : {}),
      ...(Array.isArray(organizations)
        ? {
            organizations: organizations.flatMap(organization =>
              isRecord(organization) && typeof organization.id === 'string'
                ? [{ id: organization.id }]
                : []
            ),
          }
        : {}),
    };
  } catch {
    return undefined;
  }
}

function extractAccountId(claims: ChatGptJwtClaims | undefined): string | undefined {
  return (
    claims?.chatgpt_account_id ||
    claims?.['https://api.openai.com/auth']?.chatgpt_account_id ||
    claims?.organizations?.[0]?.id
  );
}

export function readChatGptOAuthTokenResponse(
  value: unknown,
  now: number,
  previous?: ProviderAccountOAuthCredential
): ProviderAccountOAuthCredential {
  if (!isRecord(value)) throw new Error('ChatGPT OAuth token response 不是对象');
  if (typeof value.access_token !== 'string' || !value.access_token) {
    throw new Error('ChatGPT OAuth token response 缺少 access_token');
  }
  const refreshToken =
    typeof value.refresh_token === 'string' && value.refresh_token
      ? value.refresh_token
      : previous?.refresh_token;
  if (!refreshToken) throw new Error('ChatGPT OAuth token response 缺少 refresh_token');
  if (typeof value.expires_in !== 'number' || !Number.isSafeInteger(value.expires_in)) {
    throw new Error('ChatGPT OAuth token response 缺少 expires_in');
  }
  const idToken = typeof value.id_token === 'string' && value.id_token ? value.id_token : undefined;
  const idClaims = idToken ? parseJwtClaims(idToken) : undefined;
  const accessClaims = parseJwtClaims(value.access_token);
  const accountId =
    extractAccountId(idClaims) ?? extractAccountId(accessClaims) ?? previous?.account_id;
  if (!accountId) throw new Error('ChatGPT OAuth token 无法解析 account ID');
  const email =
    (typeof value.email === 'string' && value.email ? value.email : undefined) ??
    idClaims?.email ??
    accessClaims?.email ??
    previous?.email;
  return {
    access_token: value.access_token,
    refresh_token: refreshToken,
    expires_at: now + value.expires_in * 1000,
    account_id: accountId,
    ...(idToken
      ? { id_token: idToken }
      : previous?.id_token
        ? { id_token: previous.id_token }
        : {}),
    ...(email ? { email } : {}),
  };
}
