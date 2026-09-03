import type { ExportArtifactCommitPort } from '../../../../../features/system/export/definitions/exportArtifactCommitPort';
import type { DesktopCapabilityMailboxRpcClientPort } from '../../../desktop-capabilities';
import {
  EXPORT_ARTIFACT_COMMIT_MAILBOX_CHANNEL,
  EXPORT_ARTIFACT_COMMIT_RPC_METHOD,
} from '../definitions/exportArtifactCommitRpc';
import { parseExportArtifactCommitMailboxResult } from '../functions/exportArtifactCommitRpcCodec';

export function createExportArtifactCommitRpcClient(
  mailbox: DesktopCapabilityMailboxRpcClientPort,
): ExportArtifactCommitPort {
  const port: ExportArtifactCommitPort = {
    async commit(request) {
      const result = await mailbox.invoke(
        EXPORT_ARTIFACT_COMMIT_RPC_METHOD,
        EXPORT_ARTIFACT_COMMIT_MAILBOX_CHANNEL,
        [request],
      );
      return parseExportArtifactCommitMailboxResult(result);
    },
  };
  return Object.freeze(port);
}
