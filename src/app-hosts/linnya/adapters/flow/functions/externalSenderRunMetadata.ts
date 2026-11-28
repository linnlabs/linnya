import type { ConversationExternalSender, ConversationNextRequest } from '@app/schemas';

import { RUN_EXTERNAL_SENDER_METADATA_KEY } from 'src/domains/action-ledger';

/**
 * 外部入口发起的运行在登记时记下发件人，来源只有一处：这次请求里那条用户消息的 `metadata.sender`。
 * 运行里的写入要标出“是谁经命令行改的”，写入发生时拿不到消息，所以随运行冻结一份。
 * 这是显示用的标签，不进入任何权限判断。
 */
export function externalSenderRunMetadata(
  request: ConversationNextRequest,
): { readonly [RUN_EXTERNAL_SENDER_METADATA_KEY]?: ConversationExternalSender } {
  for (const event of request.new_events ?? []) {
    if (event.type === 'user_input' && event.metadata?.sender) {
      return { [RUN_EXTERNAL_SENDER_METADATA_KEY]: event.metadata.sender };
    }
  }
  return {};
}
