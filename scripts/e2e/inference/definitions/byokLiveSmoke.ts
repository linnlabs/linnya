import type { ModelInferenceRoute } from '@app/schemas/model-inference';

import type { AiSdkInferenceSurface } from '@linnlabs/linnkit-provider-ai-sdk';

export interface ByokLiveSmokeTarget {
  readonly id: string;
  readonly name: string;
  readonly capability_id: ModelInferenceRoute['capability_id'];
  readonly surface: AiSdkInferenceSurface;
  readonly endpoint_id: string;
  readonly endpoint_model_id: string;
  readonly base_url: string;
  readonly auth_profile: 'api_key' | 'bearer';
  readonly credential: string;
}

export interface ByokLiveSmokeTargetDescriptor
  extends Omit<ByokLiveSmokeTarget, 'endpoint_model_id' | 'base_url' | 'credential'> {
  readonly credentialEnvironmentVariable: string;
  readonly modelEnvironmentVariable: string;
  readonly baseUrlEnvironmentVariable: string;
  readonly defaultBaseUrl: string;
}

export interface ByokLiveSmokeConfiguration {
  readonly targets: readonly ByokLiveSmokeTarget[];
}
