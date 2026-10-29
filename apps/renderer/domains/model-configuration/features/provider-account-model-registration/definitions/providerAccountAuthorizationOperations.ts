import type {
  ProviderAccountAuthorizationResponse,
  ProviderAccountAuthorizationStatusResponse,
} from '@app/schemas/provider-account';
import type { ProviderAccountAuthorizationError } from './providerAccountAuthorizationError';

export interface ProviderAccountAuthorizationOutcome {
  readonly status: ProviderAccountAuthorizationStatusResponse['status'];
  readonly modelSynchronizationFailure?: ProviderAccountAuthorizationError;
}

/**
 * 账号授权 UI 只依赖这组稳定动作，不感知各 connection 的协议和路由细节。
 */
export interface ProviderAccountAuthorizationOperations {
  getStatus(): Promise<ProviderAccountAuthorizationStatusResponse>;
  authorize(): Promise<ProviderAccountAuthorizationResponse>;
  disconnect(): Promise<ProviderAccountAuthorizationStatusResponse>;
}
