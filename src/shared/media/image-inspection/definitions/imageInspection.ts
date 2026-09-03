export type SupportedImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageInspectionResult {
  readonly mediaType: SupportedImageMediaType;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

export type ImageInspectionErrorCode =
  | 'unsupported_image_format'
  | 'invalid_image'
  | 'image_pixel_limit_exceeded';

export class ImageInspectionError extends Error {
  readonly name = 'ImageInspectionError';

  constructor(
    readonly code: ImageInspectionErrorCode,
    message: string,
  ) {
    super(message);
  }
}
