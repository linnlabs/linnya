import type { InferenceEndpointView, ModelConfig } from 'src/domains/model-catalog';

export type SelectableModelCapability = 'chat' | 'image_generation';

export type ModelRuntimeUnavailableReason =
  | 'capability_missing'
  | 'route_missing'
  | 'credential_missing';

export type ModelRuntimeAvailability =
  | { readonly available: true }
  | {
      readonly available: false;
      readonly reason: ModelRuntimeUnavailableReason;
    };

export interface ModelRuntimeAvailabilityContext {
  readonly inferenceEndpoints: readonly InferenceEndpointView[];
  readonly hasModelCredential: (modelConfigId: string) => boolean;
  readonly hasProviderAccountCredential: (accountId: string) => boolean;
}

export interface ModelRuntimeAvailabilityInput {
  readonly model: ModelConfig;
  readonly capability: SelectableModelCapability;
  readonly context: ModelRuntimeAvailabilityContext;
}
