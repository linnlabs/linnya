import path from 'node:path';
import type {
  ConversationImageDraft,
  ConversationImageIngressPolicy,
} from '../definitions/conversationImageIngress';
import { ConversationImageIngressError } from '../definitions/conversationImageIngress';

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ConversationImageIngressError('invalid_policy', `${name} 必须是正安全整数`);
  }
}
export function validateConversationImageIngressPolicy(policy: ConversationImageIngressPolicy): void {
  assertPositiveInteger('maxImageBytes', policy.maxImageBytes);
  assertPositiveInteger('maxImagePixels', policy.maxImagePixels);
  assertPositiveInteger('maxAttachmentsPerMessage', policy.maxAttachmentsPerMessage);
  assertPositiveInteger('maxTotalBytesPerMessage', policy.maxTotalBytesPerMessage);
  if (policy.maxTotalBytesPerMessage < policy.maxImageBytes) {
    throw new ConversationImageIngressError(
      'invalid_policy',
      'maxTotalBytesPerMessage 不能小于 maxImageBytes',
    );
  }
}

export function normalizeConversationImageFileName(
  fileName: string | undefined,
): string | undefined {
  if (!fileName) return undefined;
  const normalized = fileName.trim();
  if (
    !normalized
    || normalized.length > 255
    || normalized.includes('/')
    || normalized.includes('\\')
    || normalized !== path.basename(normalized)
  ) {
    throw new ConversationImageIngressError('invalid_file_name', 'fileName 必须是非空 basename');
  }
  return normalized;
}

export function validateConversationImageAttachmentCount(
  count: number,
  policy: ConversationImageIngressPolicy,
): void {
  if (count > policy.maxAttachmentsPerMessage) {
    throw new ConversationImageIngressError(
      'too_many_attachments',
      `消息图片数量超过限制: actual=${count}, max=${policy.maxAttachmentsPerMessage}`,
    );
  }
}

export function validateConversationImageDraftTotalBytes(
  drafts: readonly ConversationImageDraft[],
  policy: ConversationImageIngressPolicy,
): void {
  const totalBytes = drafts.reduce((sum, draft) => sum + draft.byteLength, 0);
  if (totalBytes > policy.maxTotalBytesPerMessage) {
    throw new ConversationImageIngressError(
      'message_images_too_large',
      `消息图片总字节数超过限制: actual=${totalBytes}, max=${policy.maxTotalBytesPerMessage}`,
    );
  }
}

export function hasSameConversationImageIdentity(
  left: ConversationImageDraft,
  right: ConversationImageDraft,
): boolean {
  return left.sha256 === right.sha256
    && left.byteLength === right.byteLength
    && left.mediaType === right.mediaType
    && left.width === right.width
    && left.height === right.height;
}
