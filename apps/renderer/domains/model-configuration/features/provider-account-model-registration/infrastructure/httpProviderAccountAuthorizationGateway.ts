import {
  ProviderAccountAuthorizationErrorResponseSchema,
  ProviderAccountAuthorizationResponseSchema,
  ProviderAccountAuthorizationStatusResponseSchema,
} from '@app/schemas/provider-account';
import { apiFetch, getApiBaseUrl } from '@shared/services/localApiClient';

import { ProviderAccountAuthorizationError } from '../definitions/providerAccountAuthorizationError';
import type { ProviderAccountAuthorizationGateway } from '../definitions/providerAccountAuthorizationGateway';

async function readFailure(response: Response): Promise<ProviderAccountAuthorizationError> {
  const payload: unknown = await response.json();
  const parsed = ProviderAccountAuthorizationErrorResponseSchema.safeParse(payload);
  return parsed.success
    ? new ProviderAccountAuthorizationError(parsed.data.code, parsed.data.message)
    : new ProviderAccountAuthorizationError(
        'provider_account.request_failed',
        'ChatGPT 账号操作失败'
      );
}

export const httpProviderAccountAuthorizationGateway: ProviderAccountAuthorizationGateway = {
  async getChatGptStatus() {
    const baseUrl = await getApiBaseUrl();
    const response = await apiFetch(`${baseUrl}/api/v1/provider-accounts/chatgpt`);
    if (!response.ok) throw await readFailure(response);
    return ProviderAccountAuthorizationStatusResponseSchema.parse(await response.json());
  },

  async authorizeChatGpt() {
    const baseUrl = await getApiBaseUrl();
    const response = await apiFetch(`${baseUrl}/api/v1/provider-accounts/chatgpt/authorize`, {
      method: 'POST',
    });
    if (!response.ok) throw await readFailure(response);
    return ProviderAccountAuthorizationResponseSchema.parse(await response.json());
  },

  async disconnectChatGpt() {
    const baseUrl = await getApiBaseUrl();
    const response = await apiFetch(`${baseUrl}/api/v1/provider-accounts/chatgpt`, {
      method: 'DELETE',
    });
    if (!response.ok) throw await readFailure(response);
    return ProviderAccountAuthorizationStatusResponseSchema.parse(await response.json());
  },
};
