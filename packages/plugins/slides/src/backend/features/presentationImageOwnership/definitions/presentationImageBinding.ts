export interface PresentationImageBinding {
  readonly presentationId: string;
  readonly sourceIdentity: string;
  readonly assetId: string;
  readonly createdAt: number;
}

export interface PresentationImageBindingReaderPort {
  find(input: {
    readonly presentationId: string;
    readonly sourceIdentity: string;
  }): PresentationImageBinding | null;
}

export interface PresentationImageBindingRepositoryPort extends PresentationImageBindingReaderPort {
  bind(input: {
    readonly presentationId: string;
    readonly sourceIdentity: string;
    readonly assetId: string;
    readonly createdAt?: number;
  }): PresentationImageBinding;
}
