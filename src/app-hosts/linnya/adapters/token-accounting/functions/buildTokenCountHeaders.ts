import type { ModelRequestCredential } from '../../model-request-auth';
import type { TokenCountSurface } from '../definitions/tokenCountCapability';

export function buildTokenCountHeaders(
  surface: TokenCountSurface,
  credential: ModelRequestCredential | undefined
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(credential?.request_headers ?? {}),
  };
  if (!credential) return headers;

  if (surface === 'gemini_generate_content_count_tokens') {
    headers['x-goog-api-key'] = credential.secret;
    return headers;
  }
  if (surface === 'anthropic_messages_count_tokens') {
    if (credential.profile === 'api_key') {
      headers['x-api-key'] = credential.secret;
      headers['anthropic-version'] = headers['anthropic-version'] ?? '2023-06-01';
      return headers;
    }
    if (credential.profile !== 'bearer') {
      throw new Error(
        '[TokenAccounting] Anthropic count surface 需要 api_key 或 bearer credential。'
      );
    }
  }
  headers.Authorization = `Bearer ${credential.secret}`;
  return headers;
}
