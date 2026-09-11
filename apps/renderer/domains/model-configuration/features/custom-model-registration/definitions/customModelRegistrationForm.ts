import type { CustomApiFormat, CustomApiModelItem } from '@app/schemas';

export interface ApiCustomModelForm {
  providerName: string;
  endpointModelId: string;
  displayName: string;
  credentialSecret: string;
  baseUrl: string;
  customApiFormat: CustomApiFormat;
  contextWindowTokens: string;
  maxOutputTokens: string;
  supportsImageInput: boolean;
  models?: CustomApiModelItem[];
}

export interface RegistrationFormStatus {
  isSubmitting: boolean;
  success: boolean;
  error: string | null;
}
