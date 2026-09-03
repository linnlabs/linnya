import {
  ConversationAttachmentRefSchema,
  type ConversationAttachmentRef,
} from '@app/schemas';
import type { RuntimeResourceRef } from 'linnkit/contracts';

export type UiMessageAttachments = readonly ConversationAttachmentRef[];

/** Runtime 的 provider-neutral resourceId 只在 UI 出口映射为 conversation assetId。 */
export function mapRuntimeAttachmentsToUi(
  attachments: readonly RuntimeResourceRef[] | undefined,
): UiMessageAttachments | null {
  if (!attachments || attachments.length === 0) return null;
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

export function serializeUiMessageAttachments(
  attachments: UiMessageAttachments | null,
): string | null {
  return attachments ? JSON.stringify(attachments) : null;
}

export function parseUiMessageAttachments(
  messageId: string,
  attachmentsJson: string | null,
): UiMessageAttachments | null {
  if (!attachmentsJson) return null;
  const parsed = ConversationAttachmentRefSchema.array().safeParse(JSON.parse(attachmentsJson));
  if (!parsed.success || parsed.data.length === 0) {
    throw new Error(
      `[ConversationUiProjection] attachments_json for message ${messageId} is invalid`,
    );
  }
  return parsed.data;
}
