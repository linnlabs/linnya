import type {
  ExportArtifactCommitRequest,
  ExportArtifactCommitResult,
  ExportArtifactTarget,
  ExportArtifactTargetRequest,
} from '@linnya/plugin-host-contract';

export interface ExportArtifactTargetRecord {
  readonly token: string;
  readonly pluginId: string;
  readonly filePath: string;
  readonly fileName: string;
  readonly extension: string;
  readonly mediaType: string;
  readonly expiresAtMs: number;
}

export interface ExportArtifactTargetRegistry {
  authorize(
    request: ExportArtifactTargetRequest,
    selectedFilePath: string,
  ): ExportArtifactTarget;
  commit(request: ExportArtifactCommitRequest): Promise<ExportArtifactCommitResult>;
}
