import type { ConversationImageAttachmentErrorCode } from '@app/schemas';
import type { ConversationMessageKey } from '../../../definitions/conversationMessages';

const IMAGE_ATTACHMENT_ERROR_MESSAGES = {
  'conversation.image.invalid_request': 'conversation.error.imageUploadInvalidRequest',
  'conversation.image.too_large': 'conversation.error.imageTooLarge',
  'conversation.image.unsupported_format': 'conversation.error.imageUnsupportedFormat',
  'conversation.image.invalid_image': 'conversation.error.imageInvalid',
  'conversation.image.pixel_limit_exceeded': 'conversation.error.imagePixelLimitExceeded',
  'conversation.image.invalid_file_name': 'conversation.error.imageInvalidFileName',
  'conversation.image.staging_failed': 'conversation.error.imageStagingFailed',
  'conversation.image.draft_not_found': 'conversation.error.imageDraftUnavailable',
  'conversation.image.draft_changed': 'conversation.error.imageDraftUnavailable',
  'conversation.image.too_many_attachments': 'conversation.error.imageTooManyAttachments',
  'conversation.image.total_bytes_exceeded': 'conversation.error.imageTotalBytesExceeded',
  'conversation.image.asset_not_found': 'conversation.error.imagePreviewUnavailable',
  'conversation.image.asset_integrity_failed': 'conversation.error.imagePreviewIntegrityFailed',
  'conversation.image.preview_failed': 'conversation.error.imagePreviewFailed',
} satisfies Readonly<Record<ConversationImageAttachmentErrorCode, ConversationMessageKey>>;

export function resolveImageAttachmentErrorMessage(
  code: ConversationImageAttachmentErrorCode,
): ConversationMessageKey {
  return IMAGE_ATTACHMENT_ERROR_MESSAGES[code];
}
