import type { LlmImageInputEstimatorPort } from 'linnkit/ports';
import type { ImageInputProcessingProfile } from './imageInputProcessingProfile';

export interface ImageInputProcessingProfileRegistry extends LlmImageInputEstimatorPort {
  resolveForModel(activeModelId: string): ImageInputProcessingProfile | undefined;
}

export interface ImageInputProcessingProfileBinding {
  readonly route: string;
  readonly profile: ImageInputProcessingProfile;
}
