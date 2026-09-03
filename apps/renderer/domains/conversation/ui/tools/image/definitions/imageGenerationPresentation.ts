export interface ImageGenerationPresentationImage {
  readonly path: string;
  readonly mediaType?: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly width?: number;
  readonly height?: number;
}

export interface ImageGenerationPresentationData {
  readonly images: readonly ImageGenerationPresentationImage[];
}
