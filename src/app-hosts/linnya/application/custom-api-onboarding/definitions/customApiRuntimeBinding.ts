import type { CustomApiFormat } from '@app/schemas/custom-api-onboarding';
import type {
  InferenceAuthProfile,
  LanguageInferenceRouteProfileId,
} from '@app/schemas/model-inference';

export interface CustomApiRuntimeBinding {
  readonly api_format: CustomApiFormat;
  readonly route_profile_id: LanguageInferenceRouteProfileId;
  readonly endpoint_id: string;
  readonly auth_profile: InferenceAuthProfile;
}
