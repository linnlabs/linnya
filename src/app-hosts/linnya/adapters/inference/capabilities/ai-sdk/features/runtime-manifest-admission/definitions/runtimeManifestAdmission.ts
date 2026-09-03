import type {
  InferenceApiSurface,
  InferenceAuthProfile,
  ModelInferenceRoute,
} from '@app/schemas/model-inference';

import type { FormalProviderRuntimeBinding } from '@linnya/provider-catalog/runtime-bindings';

export interface AiSdkFactoryAdmissionDescriptor {
  readonly capability_id: ModelInferenceRoute['capability_id'];
  readonly surface: InferenceApiSurface;
  readonly auth_profiles: readonly InferenceAuthProfile[];
}

export interface FormalProviderRuntimeAdmissionInput {
  readonly bindings: readonly FormalProviderRuntimeBinding[];
  readonly factories: readonly AiSdkFactoryAdmissionDescriptor[];
}
