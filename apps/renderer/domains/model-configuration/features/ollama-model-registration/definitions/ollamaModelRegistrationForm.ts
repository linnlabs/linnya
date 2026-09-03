export interface OllamaModelRegistrationFormValues {
  endpointModelId: string;
  displayName: string;
  serviceUrl: string;
  contextWindowTokens: string;
  maxOutputTokens: string;
}

export interface OllamaRegistrationFormStatus {
  isSubmitting: boolean;
  success: boolean;
  error: string | null;
}
