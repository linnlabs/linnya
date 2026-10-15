import type { CustomApiFormat, CustomApiModelItem } from '@app/schemas/custom-api-onboarding';
import type { InferenceEndpointView } from 'src/domains/model-catalog';

export interface CustomApiProviderRefreshTarget {
  readonly endpoint: InferenceEndpointView;
  readonly apiFormat: CustomApiFormat;
  readonly credentialModelId: string;
  readonly existingRemoteModelIds: ReadonlySet<string>;
}

export type NewCustomApiDiscoveredModel = CustomApiModelItem & { readonly picker_enabled: boolean };
