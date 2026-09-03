import type {
  CustomApiModelRegistrationCommand,
  CustomApiModelRegistrationResponse,
} from '@app/schemas/custom-api-onboarding';
import type {
  InferenceEndpointSelection,
  InferenceEndpointView,
  ModelConfig,
} from 'src/domains/model-catalog';

export interface CustomApiOnboardingModelCatalogPort {
  getInferenceEndpoints(): InferenceEndpointView[];
  registerUserModel(model: ModelConfig, endpoint: InferenceEndpointSelection): Promise<void>;
}

export interface CustomApiOnboardingIdFactory {
  create(): string;
}

export interface CustomApiOnboardingUseCase {
  registerModel(
    command: CustomApiModelRegistrationCommand
  ): Promise<CustomApiModelRegistrationResponse>;
}
