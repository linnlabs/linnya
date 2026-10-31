import type { CredentialStoragePort } from 'src/shared/credential-storage';

export const CHATGPT_PROVIDER_ACCOUNT_ID = 'chatgpt-subscription';
export const CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID = 'openai-chatgpt-subscription';

export type ProviderAccountCredentialStatus = 'available';

/** 用户对一个正式模型供应商完成授权后形成的账号身份。 */
export interface ProviderAccount {
  readonly id: string;
  readonly provider_connection_definition_id: string;
  readonly auth_method: 'oauth_pkce';
  readonly created_at: string;
  readonly updated_at: string;
}

/** OAuth 内部凭据；禁止进入目录 DTO、日志或 Renderer 状态。 */
export interface ProviderAccountOAuthCredential {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_at: number;
  readonly account_id: string;
  readonly id_token?: string;
  readonly email?: string;
}

export interface ProviderAccountRegistry {
  installCredentialStorage(storage: CredentialStoragePort): void;
  initialize(): Promise<void>;
  list(): readonly ProviderAccount[];
  get(accountId: string): ProviderAccount | undefined;
  hasCredential(accountId: string): boolean;
  getCredentialStatus(accountId: string): ProviderAccountCredentialStatus | 'missing';
  /** 由 App Server 读取私有文件；推理热路径不跨进程等待 Desktop Host。 */
  resolveOAuthCredential(accountId: string): ProviderAccountOAuthCredential;
  putOAuthCredential(
    account: Omit<ProviderAccount, 'created_at' | 'updated_at'>,
    credential: ProviderAccountOAuthCredential
  ): Promise<ProviderAccount>;
  remove(accountId: string): Promise<void>;
}

export interface ProviderAccountRequestCredential {
  readonly access_token: string;
  readonly request_headers: Readonly<Record<string, string>>;
}

export interface ProviderAccountRequestCredentialResolver {
  resolve(accountId: string): Promise<ProviderAccountRequestCredential>;
}

/**
 * 账号授权后由供应商返回的可用模型事实。
 *
 * 该合同只描述账户目录，不携带 OAuth token、runtime package 或持久化身份。
 */
export interface ProviderAccountModelDefinition {
  readonly id: string;
  readonly display_name: string;
  readonly context_window_tokens: number;
  readonly max_input_tokens: number;
  readonly max_output_tokens: number;
  readonly capabilities: {
    readonly image_input: boolean;
    readonly tool_call: boolean;
    readonly reasoning: boolean;
  };
}

export interface ProviderAccountModelDiscovery {
  listModels(accountId: string, signal?: AbortSignal): Promise<readonly ProviderAccountModelDefinition[]>;
}
