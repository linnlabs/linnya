export interface ImageGenerationRequest {
  readonly modelId: string;
  readonly prompt: string;
  readonly size: string;
  readonly count: number;
  readonly signal?: AbortSignal;
}

export interface GeneratedImage {
  readonly bytes: Uint8Array;
}

export interface ImageGenerationResult {
  readonly model: string;
  readonly images: readonly GeneratedImage[];
}

export interface ImageGenerationConstraints {
  readonly min_pixels?: number;
  readonly max_pixels?: number;
  readonly allowed_sizes?: readonly string[];
}

export type ImageGenerationFailureKind = 'aborted' | 'transport' | 'provider' | 'protocol';

export class ImageGenerationFailure extends Error {
  constructor(
    readonly kind: ImageGenerationFailureKind,
    readonly code: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'ImageGenerationFailure';
  }
}

export interface ImageGenerationPort {
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
}
