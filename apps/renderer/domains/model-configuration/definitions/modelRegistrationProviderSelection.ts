export const CUSTOM_PROVIDER_SELECTION = 'custom' as const;

export type ModelRegistrationProviderSelection =
  | typeof CUSTOM_PROVIDER_SELECTION
  | `provider:${string}`;

export interface ModelRegistrationQuickProviderOption {
  readonly value: ModelRegistrationProviderSelection;
  readonly text: string;
  /** 常用入口需要直达某条接入方式时使用，例如 Ollama Cloud。 */
  readonly preferredConnectionDefinitionId?: string;
}

export interface ModelRegistrationProviderOption {
  readonly value: ModelRegistrationProviderSelection | `connection:${string}`;
  readonly text: string;
}

export interface ModelRegistrationConnectionChoice {
  readonly value: `connection:${string}`;
  readonly label: string;
  readonly description?: string;
  readonly badge?: string;
}
