import type { CustomApiFormat, CustomApiModelItem } from '@app/schemas';

export interface CustomApiRegistrationDraft {
  providerName: string;
  baseUrl: string;
  credentialSecret: string;
  customApiFormat: CustomApiFormat;
}

export interface CustomApiRegistrationSelection {
  readonly item: CustomApiModelItem & { readonly display_name: string };
  readonly enabled: boolean;
}

export interface CustomApiRegistrationSessionState {
  form: CustomApiRegistrationDraft;
  models: CustomApiRegistrationSelection[];
  userEditedProviderName: boolean;
  isDiscovering: boolean;
  discoveryFeedback: { kind: 'info' | 'error'; message: string } | null;
  status: { isSubmitting: boolean; success: boolean; error: string | null };
}

/** 文案由 UI 的本地化入口提供，流程不依赖 Settings domain 的实现。 */
export interface CustomApiRegistrationMessages {
  readonly invalidUrl: string;
  readonly discoveryEmpty: string;
  readonly discoveryFailed: string;
  readonly invalidConfiguration: string;
  readonly registrationFailed: string;
  readonly synchronizationFailed: string;
}
