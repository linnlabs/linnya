export interface DirectProviderOnboardingForm {
  providerConnectionDefinitionId: string;
  apiKey: string;
}

export type DirectProviderOnboardingIssue = 'provider_required' | 'api_key_required';

export type DirectProviderOnboardingResult =
  | { readonly ok: true; readonly modelIds: readonly string[] }
  | { readonly ok: false; readonly issue: DirectProviderOnboardingIssue };
