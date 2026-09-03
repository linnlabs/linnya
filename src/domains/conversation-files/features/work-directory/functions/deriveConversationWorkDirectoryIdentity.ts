import { createHash } from 'node:crypto';

import {
  CONVERSATION_WORK_DIRECTORY_KIND,
  CONVERSATION_WORK_DIRECTORY_REVISION,
  ConversationWorkDirectoryConversationIdSchema,
  ConversationWorkDirectoryDigestSchema,
  ConversationWorkDirectoryKeySchema,
  type ConversationWorkDirectoryIdentity,
} from '../../../definitions/conversationWorkDirectory';
import { ConversationDirectoryError } from '../../../definitions/conversationDirectoryFailure';

/**
 * 通用 path sanitizer 会替换非法字符并截断长文本，不同 conversation 会因此碰撞。
 * 完整 SHA-256 让路径段固定、跨平台且不暴露原始 ID；原始归属再由 App-owned sidecar 校验。
 */
export function deriveConversationWorkDirectoryIdentity(
  rawConversationId: unknown,
): ConversationWorkDirectoryIdentity {
  const parsed = ConversationWorkDirectoryConversationIdSchema.safeParse(rawConversationId);
  if (!parsed.success) {
    throw new ConversationDirectoryError(
      'invalid_conversation_identity',
      'derive_identity',
    );
  }

  const digest = ConversationWorkDirectoryDigestSchema.parse(
    createHash('sha256').update(parsed.data, 'utf8').digest('hex'),
  );
  const directoryKey = ConversationWorkDirectoryKeySchema.parse(`conversation_${digest}`);

  return Object.freeze({
    kind: CONVERSATION_WORK_DIRECTORY_KIND,
    revision: CONVERSATION_WORK_DIRECTORY_REVISION,
    conversationId: parsed.data,
    conversationIdDigest: digest,
    directoryKey,
  });
}
