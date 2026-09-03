import type {
  ProviderAccountAuthorizationResponse,
  ProviderAccountAuthorizationStatusResponse,
} from '@app/schemas/provider-account';
import type {
  ChatGptOAuthTokenClient,
  ProviderAccountRegistry,
} from 'src/domains/provider-account';
import type { ProviderAccountModelProjection } from '../../provider-account-model-projection';

export interface OAuthLoopbackCallback {
  readonly authorization_code: Promise<string>;
  close(): Promise<void>;
}

export interface OAuthLoopbackPort {
  listen(input: {
    readonly expected_state: string;
    readonly timeout_ms: number;
  }): Promise<OAuthLoopbackCallback>;
}

export interface ExternalAuthorizationBrowserPort {
  open(url: string): Promise<void>;
}

export interface ProviderAccountAuthorizationUseCase {
  authorizeChatGpt(): Promise<ProviderAccountAuthorizationResponse>;
  getChatGptStatus(): ProviderAccountAuthorizationStatusResponse;
  disconnectChatGpt(): Promise<ProviderAccountAuthorizationStatusResponse>;
}

/** 授权 use case 只发起账号型 Provider 的模型同步，不依赖 onboarding 内部实现。 */
export interface ConnectedProviderModelSynchronizationPort {
  synchronizeConnectedProviderModels(providerConnectionDefinitionId: string): Promise<void>;
}

export interface ProviderAccountAuthorizationDependencies {
  readonly accounts: ProviderAccountRegistry;
  readonly chatGptTokens: ChatGptOAuthTokenClient;
  readonly loopback: OAuthLoopbackPort;
  readonly browser: ExternalAuthorizationBrowserPort;
  readonly providerModels: ConnectedProviderModelSynchronizationPort;
  readonly accountModels: ProviderAccountModelProjection;
}
