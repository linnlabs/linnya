import type { ProviderModelDefinition } from '@linnya/provider-catalog';

export type ProviderDiscoveredModel =
  | { readonly status: 'available'; readonly definition: ProviderModelDefinition }
  | {
      readonly status: 'unavailable';
      readonly id: string;
      readonly display_name: string;
      readonly reason: string;
    };

export interface ProviderModelDiscoveryRequest {
  readonly connectionId: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly signal?: AbortSignal;
  readonly bundledModels: readonly ProviderModelDefinition[];
}

export interface ProviderModelDiscovery {
  supports(connectionId: string): boolean;
  discover(request: ProviderModelDiscoveryRequest): Promise<readonly ProviderDiscoveredModel[]>;
}

/** 错误只包含可展示消息与 HTTP 状态，不携带响应正文、请求地址或凭据。 */
export class ProviderModelDiscoveryError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'ProviderModelDiscoveryError';
  }
}
