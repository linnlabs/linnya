import type { CustomApiProviderRemovalResponse } from '@app/schemas/custom-api-onboarding';
import type { CustomApiProviderRemovalGateway } from '../definitions/customApiProviderRemoval';
import { httpCustomApiProviderRemovalGateway } from '../infrastructure/httpCustomApiProviderRemovalGateway';

export function removeCustomApiProvider(
  providerName: string,
  gateway: CustomApiProviderRemovalGateway = httpCustomApiProviderRemovalGateway
): Promise<CustomApiProviderRemovalResponse> {
  return gateway.removeProvider({ provider_name: providerName });
}
