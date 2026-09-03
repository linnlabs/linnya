import type { ConversationAttachmentRef } from '@app/schemas';
import type { RuntimeResourceRef } from 'linnkit/contracts';

/** Renderer 只在 RuntimeEvent 投影边界把 resourceId 翻译成 conversation assetId。 */
export function mapRuntimeAttachmentsToConversation(
  attachments: readonly RuntimeResourceRef[] | undefined,
): readonly ConversationAttachmentRef[] | undefined {
  if (!attachments || attachments.length === 0) return undefined;
  return attachments.map(attachment => ({
    id: attachment.id,
    kind: attachment.kind,
    assetId: attachment.resourceId,
    mediaType: attachment.mediaType,
    byteLength: attachment.byteLength,
    width: attachment.width,
    height: attachment.height,
    sha256: attachment.sha256,
    ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
    ...(attachment.label ? { label: attachment.label } : {}),
  }));
}
