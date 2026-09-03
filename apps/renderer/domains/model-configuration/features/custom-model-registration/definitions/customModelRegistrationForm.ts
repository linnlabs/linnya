import type { CustomApiFormat } from '@app/schemas/custom-api-onboarding';

export interface ApiCustomModelForm {
  endpointModelId: string;
  displayName: string;
  credentialSecret: string;
  baseUrl: string;
  customApiFormat: CustomApiFormat;
  contextWindowTokens: string;
  maxOutputTokens: string;
  supportsImageInput: boolean;
}

export interface RegistrationFormStatus {
  isSubmitting: boolean;
  success: boolean;
  error: string | null;
}
