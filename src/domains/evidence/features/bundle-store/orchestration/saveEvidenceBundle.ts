import type {
  SaveEvidenceBundleCommand,
  SavedEvidenceBundle,
} from '../definitions/evidenceBundleWrite';
import { createEvidenceBundleRecord } from '../functions/createEvidenceBundleRecord';
import type { EvidenceBundleWriterPort } from '../ports/evidenceBundleWriter';

export async function saveEvidenceBundleWithWriter(
  command: SaveEvidenceBundleCommand,
  writer: EvidenceBundleWriterPort
): Promise<SavedEvidenceBundle> {
  const conversationId = command.scope.conversationId.trim();
  if (!conversationId) throw new Error('[EvidenceStore] conversationId 不能为空');
  const instanceId = command.scope.instanceId.trim();
  if (!instanceId) throw new Error('[EvidenceStore] instanceId 不能为空');

  const { bundleId, record } = createEvidenceBundleRecord({
    conversationId,
    command,
    createdAtMs: Date.now(),
  });
  const { filePath } = await writer.write({
    conversationId,
    instanceId,
    bundleId,
    record,
  });
  return { bundleId, filePath };
}
