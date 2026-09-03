import type { LlmImageInputEstimatorPort } from '@linnlabs/linnkit/ports';
import type { ImageInputProcessingProfile } from './imageInputProcessingProfile';

export interface ImageInputProcessingProfileRegistry extends LlmImageInputEstimatorPort {
  resolveForModel(activeModelId: string): ImageInputProcessingProfile | undefined;
}

export interface ImageInputProcessingProfileBinding {
  readonly route: string;
  readonly profile: ImageInputProcessingProfile;
}
