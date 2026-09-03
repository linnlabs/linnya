import type { ExportArtifactCommitPort } from '../../../../../features/system/export/definitions/exportArtifactCommitPort';
import type { AppServerRpcHandlerRegistry } from '../../../app-server-rpc';
import { createDesktopCapabilityMailboxRpcHandler } from '../../../desktop-capabilities';
import {
  EXPORT_ARTIFACT_COMMIT_MAILBOX_CHANNEL,
  EXPORT_ARTIFACT_COMMIT_RPC_METHOD,
} from '../definitions/exportArtifactCommitRpc';
import { parseExportArtifactCommitMailboxArgs } from '../functions/exportArtifactCommitRpcCodec';

export function createExportArtifactCommitRpcHandlers(input: {
  readonly mailboxRoot: string;
  readonly port: ExportArtifactCommitPort;
}): AppServerRpcHandlerRegistry {
  return new Map([[
    EXPORT_ARTIFACT_COMMIT_RPC_METHOD,
    createDesktopCapabilityMailboxRpcHandler({
      mailboxRoot: input.mailboxRoot,
      channel: EXPORT_ARTIFACT_COMMIT_MAILBOX_CHANNEL,
      invoke: async args => input.port.commit(parseExportArtifactCommitMailboxArgs(args)),
    }),
  ]]);
}
