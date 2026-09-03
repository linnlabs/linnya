export type JpegChromaSubsampling = '4:4:4' | '4:2:0';

export interface JpegTranscodingOptions {
  readonly quality: number;
  readonly chromaSubsampling: JpegChromaSubsampling;
  readonly maxInputPixels: number;
}

export type ImageTranscodingErrorCode =
  | 'invalid_options'
  | 'invalid_image';

export class ImageTranscodingError extends Error {
  readonly name = 'ImageTranscodingError';

  constructor(
    readonly code: ImageTranscodingErrorCode,
    message: string,
  ) {
    super(message);
  }
}
