import type {
  ExportArtifactCommitRequest,
  ExportArtifactCommitResult,
} from '@linnya/plugin-host-contract/backend/exportArtifact';
import type { ExportArtifactCommitPort } from '../../features/system/export/definitions/exportArtifactCommitPort';

let exportArtifactCommitPort: ExportArtifactCommitPort | null = null;

/** 只由 App Server composition 安装；插件仍只能看到 commitExportArtifact。 */
export function registerExportArtifactCommitPort(port: ExportArtifactCommitPort): void {
  exportArtifactCommitPort = port;
}

/** 后端插件只能提交 bytes 到 Renderer 已授权的一次性目标。 */
export function commitExportArtifact(
  request: ExportArtifactCommitRequest,
): Promise<ExportArtifactCommitResult> {
  if (!exportArtifactCommitPort) {
    throw new Error('Export artifact commit port 尚未由 App Server composition 安装');
  }
  return exportArtifactCommitPort.commit(request);
}

export type {
  ExportArtifactCommitRequest,
  ExportArtifactCommitResult,
} from '@linnya/plugin-host-contract/backend/exportArtifact';
