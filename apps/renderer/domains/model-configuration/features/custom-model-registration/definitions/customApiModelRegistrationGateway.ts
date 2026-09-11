import type {
  CustomApiModelRegistrationRequest,
  CustomApiModelRegistrationResponse,
  ModelDiscoveryRequest,
  ModelDiscoveryResponse,
} from '@app/schemas';

export interface CustomApiModelRegistrationGateway {
  register(command: CustomApiModelRegistrationRequest): Promise<CustomApiModelRegistrationResponse>;
  discoverModels?(request: ModelDiscoveryRequest): Promise<ModelDiscoveryResponse>;
}
