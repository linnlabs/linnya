export interface WorkspaceAssetImagePreviewPort {
  loadImage(assetId: string, signal: AbortSignal): Promise<Blob>;
}

export interface WorkspaceAssetImagePreviewState {
  readonly visible: boolean;
  readonly loading: boolean;
  readonly src: string;
  readonly name: string;
  readonly error: string;
}

export interface WorkspaceAssetImagePreviewCandidate {
  readonly name: string;
  readonly assetId: string | null;
  readonly filePath: string | null;
  readonly remoteUri: string | null;
  readonly loadErrorMessage: string;
}

export interface WorkspaceAssetImagePreviewController {
  open(candidate: WorkspaceAssetImagePreviewCandidate): Promise<void>;
  handleImageLoadError(message: string): void;
  close(): void;
  dispose(): void;
}
