import type {
  ExportArtifactCommitRequest,
  ExportArtifactCommitResult,
} from '@linnya/plugin-host-contract/backend/exportArtifact';

export interface ExportArtifactCommitPort {
  commit(request: ExportArtifactCommitRequest): Promise<ExportArtifactCommitResult>;
}
