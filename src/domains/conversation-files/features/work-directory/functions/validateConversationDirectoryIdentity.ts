import {
  CONVERSATION_WORK_DIRECTORY_KIND,
  CONVERSATION_WORK_DIRECTORY_INITIALIZED_KIND,
  CONVERSATION_WORK_DIRECTORY_REVISION,
  ConversationWorkDirectoryInitializedMarkerV1Schema,
  ConversationWorkDirectoryOwnerMarkerV1Schema,
  type ConversationWorkDirectoryIdentity,
  type ConversationWorkDirectoryInitializedMarkerV1,
  type ConversationWorkDirectoryOwnerMarkerV1,
} from '../../../definitions/conversationWorkDirectory';
import { ConversationDirectoryError } from '../../../definitions/conversationDirectoryFailure';

export function createConversationWorkDirectoryOwnerMarker(
  identity: ConversationWorkDirectoryIdentity,
): ConversationWorkDirectoryOwnerMarkerV1 {
  return Object.freeze({
    kind: CONVERSATION_WORK_DIRECTORY_KIND,
    revision: CONVERSATION_WORK_DIRECTORY_REVISION,
    conversation_id_digest: identity.conversationIdDigest,
  });
}

export function createConversationWorkDirectoryInitializedMarker(
  identity: ConversationWorkDirectoryIdentity,
): ConversationWorkDirectoryInitializedMarkerV1 {
  return Object.freeze({
    kind: CONVERSATION_WORK_DIRECTORY_INITIALIZED_KIND,
    revision: CONVERSATION_WORK_DIRECTORY_REVISION,
    conversation_id_digest: identity.conversationIdDigest,
  });
}

/**
 * 目录名只能帮助定位，不能单独授权后续递归删除。App-owned sidecar 必须严格匹配当前版本和
 * conversation 摘要，损坏或错配时宁可明确失败，也不能接管未知目录。
 */
export function validateConversationDirectoryIdentity(
  value: unknown,
  expected: ConversationWorkDirectoryIdentity,
): ConversationWorkDirectoryOwnerMarkerV1 {
  const parsed = ConversationWorkDirectoryOwnerMarkerV1Schema.safeParse(value);
  if (
    !parsed.success
    || parsed.data.conversation_id_digest !== expected.conversationIdDigest
  ) {
    throw new ConversationDirectoryError(
      'work_directory_unsafe_entry',
      'read_identity_marker',
    );
  }
  return Object.freeze(parsed.data);
}


export function validateConversationDirectoryInitialized(
  value: unknown,
  expected: ConversationWorkDirectoryIdentity,
): ConversationWorkDirectoryInitializedMarkerV1 {
  const parsed = ConversationWorkDirectoryInitializedMarkerV1Schema.safeParse(value);
  if (
    !parsed.success
    || parsed.data.conversation_id_digest !== expected.conversationIdDigest
  ) {
    throw new ConversationDirectoryError(
      'work_directory_unsafe_entry',
      'read_identity_marker',
    );
  }
  return Object.freeze(parsed.data);
}
