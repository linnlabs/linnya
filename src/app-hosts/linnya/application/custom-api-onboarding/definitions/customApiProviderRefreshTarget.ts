import type { CustomApiFormat, CustomApiModelItem } from '@app/schemas/custom-api-onboarding';
import type { InferenceEndpointView, ModelConfig } from 'src/domains/model-catalog';

export interface CustomApiProviderRefreshTarget {
  readonly endpoint: InferenceEndpointView;
  readonly apiFormat: CustomApiFormat;
  readonly existingModels: readonly ModelConfig[];
}

export type NewCustomApiDiscoveredModel = CustomApiModelItem & { readonly picker_enabled: boolean };

export interface CustomApiProviderRefreshChanges {
  readonly target: CustomApiProviderRefreshTarget;
  readonly addedModels: readonly NewCustomApiDiscoveredModel[];
  readonly removedModelIds: readonly string[];
}
