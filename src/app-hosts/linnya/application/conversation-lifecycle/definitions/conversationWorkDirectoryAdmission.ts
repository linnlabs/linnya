import type {
  ConversationWorkDirectoryResolution,
} from '../../../../../domains/conversation-files';

export interface ConversationWorkDirectoryAdmissionInput {
  readonly conversationId: unknown;
}

/**
 * callback 是删除与长期 owner 之间的临界区边界。调用方必须在 callback 返回前让 owner
 * 对删除流程可见；不能先取出路径再注册，否则 cleanup job 可以插入两步之间。
 */
export interface ConversationWorkDirectoryAdmissionPort {
  withAdmission<T>(
    input: ConversationWorkDirectoryAdmissionInput,
    admitted: (directory: ConversationWorkDirectoryResolution) => Promise<T> | T,
  ): Promise<T>;
}
