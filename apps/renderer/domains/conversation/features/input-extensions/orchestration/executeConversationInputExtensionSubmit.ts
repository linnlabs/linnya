import type {
  ConversationInputExtensionSubmitPayload,
  HostConversationInputExtension,
} from '../definitions/conversationInputExtensions';

export interface ExecuteConversationInputExtensionSubmitInput {
  readonly extension: HostConversationInputExtension;
  readonly payload: ConversationInputExtensionSubmitPayload;
  readonly clearDraftAfterStart: () => void;
}

/**
 * 扩展必须先同步快照自己的业务状态，宿主才能清空 composer。
 * 扩展允许在 onSubmit 的同步段读取私有状态；反转顺序会让清空通知提前破坏该快照。
 */
export async function executeConversationInputExtensionSubmit(
  input: ExecuteConversationInputExtensionSubmitInput,
): Promise<void> {
  let submission: void | Promise<void>;
  try {
    submission = input.extension.onSubmit(input.payload);
  } finally {
    input.clearDraftAfterStart();
  }
  await submission;
}
