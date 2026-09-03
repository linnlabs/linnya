import type { ProviderAccountAuthorizationGateway } from '../definitions/providerAccountAuthorizationGateway';
import type { ProviderAccountAuthorizationOperations } from '../definitions/providerAccountAuthorizationOperations';
import { httpProviderAccountAuthorizationGateway } from '../infrastructure/httpProviderAccountAuthorizationGateway';

export async function loadChatGptAccountStatus(
  gateway: ProviderAccountAuthorizationGateway = httpProviderAccountAuthorizationGateway
) {
  return gateway.getChatGptStatus();
}

export async function authorizeChatGptAccount(
  gateway: ProviderAccountAuthorizationGateway = httpProviderAccountAuthorizationGateway
) {
  return gateway.authorizeChatGpt();
}

export async function disconnectChatGptAccount(
  gateway: ProviderAccountAuthorizationGateway = httpProviderAccountAuthorizationGateway
) {
  return gateway.disconnectChatGpt();
}

export const chatGptProviderAccountAuthorizationOperations: ProviderAccountAuthorizationOperations =
  {
    getStatus: loadChatGptAccountStatus,
    authorize: authorizeChatGptAccount,
    disconnect: disconnectChatGptAccount,
  };
