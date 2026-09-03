export type {
  ExportArtifactDescriptor,
  ExportArtifactDialogLabels,
  ExportArtifactTarget,
  ExportArtifactTargetRequest,
  ExportArtifactTargetResult,
} from '../exportArtifact';

import type {
  ExportArtifactTargetRequest,
  ExportArtifactTargetResult,
} from '../exportArtifact';

export declare function requestExportArtifactTarget(
  request: ExportArtifactTargetRequest,
): Promise<ExportArtifactTargetResult>;
