import type { CustomApiProviderRefreshResponse } from '@app/schemas/custom-api-onboarding';
import type { CustomApiProviderRefreshGateway } from '../definitions/customApiProviderRefresh';
import { httpCustomApiProviderRefreshGateway } from '../infrastructure/httpCustomApiProviderRefreshGateway';

/** 已保存分组的刷新只发送身份；不能把凭据读回 Renderer 再复用首次发现表单。 */
export async function refreshCustomApiProvider(
  providerName: string,
  gateway: CustomApiProviderRefreshGateway = httpCustomApiProviderRefreshGateway
): Promise<CustomApiProviderRefreshResponse> {
  return gateway.refreshProvider({ provider_name: providerName });
}
