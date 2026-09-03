import type {
  ProviderAccountAuthorizationResponse,
  ProviderAccountAuthorizationStatusResponse,
} from '@app/schemas/provider-account';

export interface ProviderAccountAuthorizationGateway {
  getChatGptStatus(): Promise<ProviderAccountAuthorizationStatusResponse>;
  authorizeChatGpt(): Promise<ProviderAccountAuthorizationResponse>;
  disconnectChatGpt(): Promise<ProviderAccountAuthorizationStatusResponse>;
}
