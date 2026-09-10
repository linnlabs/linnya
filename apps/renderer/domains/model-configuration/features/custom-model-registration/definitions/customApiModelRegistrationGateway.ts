import type {
  CustomApiModelRegistrationCommand,
  CustomApiModelRegistrationResponse,
  ModelDiscoveryRequest,
  ModelDiscoveryResponse,
} from '@app/schemas';

export interface CustomApiModelRegistrationGateway {
  register(command: CustomApiModelRegistrationCommand): Promise<CustomApiModelRegistrationResponse>;
  discoverModels?(request: ModelDiscoveryRequest): Promise<ModelDiscoveryResponse>;
}
