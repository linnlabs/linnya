import type { ConversationImageIngressPolicy } from 'src/features/conversation/attachments/features/image-ingress';
import {
  CONVERSATION_IMAGE_MAX_ATTACHMENTS,
  CONVERSATION_IMAGE_MAX_BYTES,
  CONVERSATION_IMAGE_MAX_TOTAL_BYTES,
} from '@app/schemas';
import { ASSET_IMAGE_MAX_PIXELS } from 'src/domains/assets/definitions/imageAssetPolicy';

/** Linnya 会话图片进入受管存储前的生产门禁。 */
export const LINNYA_FLOW_IMAGE_INGRESS_POLICY: ConversationImageIngressPolicy = {
  maxImageBytes: CONVERSATION_IMAGE_MAX_BYTES,
  maxImagePixels: ASSET_IMAGE_MAX_PIXELS,
  maxAttachmentsPerMessage: CONVERSATION_IMAGE_MAX_ATTACHMENTS,
  maxTotalBytesPerMessage: CONVERSATION_IMAGE_MAX_TOTAL_BYTES,
};
