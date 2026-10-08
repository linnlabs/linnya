import type {
  CommandApprovalPageSnapshotV1,
  CommandCardControlPageSnapshotV1,
} from '@app/schemas/commands';
import type {
  ToolCardPresentation,
  ToolUiExecutionIdentity,
} from '@linnya/plugin-host-contract/renderer/toolUi';
import type {
  CommandExecutionDisplay,
  CommandExecutionPresentationData,
} from '../definitions/commandExecutionPresentation';
import { applyCommandCardSettlement } from './applyCommandCardSettlement';
import { projectCommandExecutionTitle } from './projectCommandExecutionPresentation';

/**
 * 审批与进程终态是两个 owner 的事实，不能用工具 loading 代替它们。
 * 只派生当前卡片的展示，不修改 durable 工具结果或把审批通过当作执行成功。
 */
export function resolveCommandExecutionDisplay(input: {
  readonly presentation: ToolCardPresentation<CommandExecutionPresentationData>;
  readonly conversationId?: string;
  readonly toolIdentity?: ToolUiExecutionIdentity;
  readonly approvals?: CommandApprovalPageSnapshotV1;
  readonly controls?: CommandCardControlPageSnapshotV1;
}): CommandExecutionDisplay {
  let data = input.presentation.data;
  const { conversationId, toolIdentity } = input;
  if (conversationId && toolIdentity && input.controls?.conversation_id === conversationId) {
    const settlement = input.controls.settlements.find(
      value =>
        value.agent_run_id === toolIdentity.runId &&
        (value.origin_tool_call_id === toolIdentity.toolCallId ||
          (data.kind === 'command_execution' &&
            data.processHandle !== undefined &&
            data.processHandle === value.process_handle))
    );
    data = applyCommandCardSettlement(data, settlement, { conversationId, ...toolIdentity });
  }

  // 确认进程已经启动或结束后，迟到的审批快照不能重新盖住实际进程事实。
  const pending =
    data.source === 'shell' && data.state === 'starting' && toolIdentity
      ? input.approvals?.pending.find(
          value =>
            value.conversation_id === conversationId &&
            value.agent_run_id === toolIdentity.runId &&
            value.origin_tool_call_id === toolIdentity.toolCallId
        )
      : undefined;
  if (!pending) return { data, title: projectCommandExecutionTitle(data) };
  return {
    data,
    approvalStatus: pending.status,
    title: {
      text: {
        key:
          pending.status === 'awaiting_reply'
            ? 'conversation.tool.command.shellAwaitingApproval'
            : 'conversation.tool.command.shellApprovalProcessing',
        fallback:
          pending.status === 'awaiting_reply'
            ? `Awaiting approval: ${pending.command}`
            : `Processing approval: ${pending.command}`,
        params: { command: pending.command },
      },
    },
  };
}
