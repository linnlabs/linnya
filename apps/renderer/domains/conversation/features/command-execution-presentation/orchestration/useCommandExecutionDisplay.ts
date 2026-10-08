import { computed } from 'vue';
import type {
  ToolCardPresentation,
  ToolUiExecutionIdentity,
} from '@linnya/plugin-host-contract/renderer/toolUi';
import { useCommandApprovalProjectionStore } from '../../command-approval';
import type { CommandExecutionPresentationData } from '../definitions/commandExecutionPresentation';
import { useCommandCardControlStore } from '../store/commandCardControlStore';
import { resolveCommandExecutionDisplay } from '../functions/resolveCommandExecutionDisplay';

/** 标题和正文共同消费一次规则，快照恢复与实时推送不会各自解释命令生命周期。 */
export function useCommandExecutionDisplay(input: {
  readonly presentation: () => ToolCardPresentation<CommandExecutionPresentationData>;
  readonly conversationId: () => string | undefined;
  readonly toolIdentity: () => ToolUiExecutionIdentity | undefined;
}) {
  const approvals = useCommandApprovalProjectionStore();
  const controls = useCommandCardControlStore();
  return computed(() =>
    resolveCommandExecutionDisplay({
      presentation: input.presentation(),
      conversationId: input.conversationId(),
      toolIdentity: input.toolIdentity(),
      approvals: approvals.snapshot,
      controls: controls.snapshot,
    })
  );
}
