import type { SupportedImageMediaType } from 'src/shared/media/image-inspection';

export interface GeneratedImagePublicationPolicy {
  readonly maxImageBytes: number;
  readonly maxImagePixels: number;
}

export interface PublishGeneratedImageInput {
  readonly bytes: Buffer;
  readonly outputDir: string;
  readonly originalPrompt: string;
  readonly revisedPrompt?: string;
  readonly model: string;
  readonly policy: GeneratedImagePublicationPolicy;
}

/** generate_image 写入 conversation 工作区后返回的完整媒体事实。 */
export interface SavedGeneratedImageInfo {
  readonly filePath: string;
  readonly fileName: string;
  readonly mediaType: SupportedImageMediaType;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly originalPrompt: string;
  readonly revisedPrompt?: string;
  readonly createdAt: string;
  readonly model: string;
}

export type GeneratedImagePublicationFailure =
  | 'invalid_policy'
  | 'image_too_large';

export class GeneratedImagePublicationError extends Error {
  readonly name = 'GeneratedImagePublicationError';

  constructor(
    readonly failure: GeneratedImagePublicationFailure,
    message: string,
  ) {
    super(message);
  }
}
