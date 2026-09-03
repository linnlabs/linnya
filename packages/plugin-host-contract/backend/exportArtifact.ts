export type {
  ExportArtifactCommitRequest,
  ExportArtifactCommitResult,
  ExportArtifactDescriptor,
  ExportArtifactTarget,
} from '../exportArtifact';

import type {
  ExportArtifactCommitRequest,
  ExportArtifactCommitResult,
} from '../exportArtifact';

export declare function commitExportArtifact(
  request: ExportArtifactCommitRequest,
): Promise<ExportArtifactCommitResult>;
