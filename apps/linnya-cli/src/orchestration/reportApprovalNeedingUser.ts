import {
  CONVERSATION_CONTROL_SCHEMA_VERSION,
  type ConversationControlRunStatusSnapshot,
} from '@app/schemas';
import { LinnyaCliError, type ConversationControlClient } from '../definitions/cli';

/**
 * watch 停在待批准的命令上时，分清这一步调用方能不能自己做。
 * 只有用户能批（默认）时以 `approval_requires_user` 结束，退出码与提交允许被拒时相同：
 * 外部 Agent 据此停下来转告用户，而不是把“watch 成功返回”当成可以接着查。
 * 实例放开了代批时照常成功返回，由调用方用 approvals / approval-reply 处理。
 */
export async function reportApprovalNeedingUser(
  client: ConversationControlClient,
  snapshot: ConversationControlRunStatusSnapshot | null,
): Promise<void> {
  if (!snapshot?.command_approvals.some(approval => approval.status === 'awaiting_reply')) return;
  const response = await client.execute({
    schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
    command: 'command_approvals',
    action: 'list',
    conversation_id: snapshot.conversation_id,
    run_id: snapshot.run_id,
  });
  if (response.command !== 'command_approvals' || response.action !== 'list') {
    throw new LinnyaCliError('protocol_incompatible', 'Approvals command returned another response type');
  }
  if (!response.external_approval.permitted) {
    throw new LinnyaCliError('approval_requires_user', response.external_approval.message, false, 'status');
  }
}
