import type {
  CustomCapabilityApiFormat,
  CustomCapabilityModelRequest,
  CustomCapabilityTestResult,
  CustomApiModelRegistrationResponse,
} from '@app/schemas/custom-api-onboarding';

export interface CustomCapabilityDraft {
  providerName: string;
  baseUrl: string;
  credentialSecret: string;
  apiFormat: CustomCapabilityApiFormat;
  modelId: string;
  displayName: string;
  ocrMode: 'document_upload' | 'page_image';
  imageSizes: string;
}

export interface CustomCapabilityRegistrationState {
  form: CustomCapabilityDraft;
  busy: 'test' | 'save' | null;
  error: string;
  feedback: string;
  saved: boolean;
}

export interface CustomCapabilityRegistrationGateway {
  test(
    request: CustomCapabilityModelRequest,
    signal: AbortSignal
  ): Promise<CustomCapabilityTestResult>;
  register(
    request: CustomCapabilityModelRequest,
    signal: AbortSignal
  ): Promise<CustomApiModelRegistrationResponse>;
}
