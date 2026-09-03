import type {
  CustomApiModelRegistrationCommand,
  CustomApiModelRegistrationResponse,
} from '@app/schemas/custom-api-onboarding';

export interface CustomApiModelRegistrationGateway {
  register(command: CustomApiModelRegistrationCommand): Promise<CustomApiModelRegistrationResponse>;
}
