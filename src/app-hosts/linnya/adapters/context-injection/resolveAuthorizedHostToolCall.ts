import type { HostToolCallRequestData } from '@app/schemas';
import type { RuntimeEvent, RunId } from '@linnlabs/linnkit/contracts';
import type { ToolContext } from 'src/tools/types';

/** Host bootstrap 是本 run 的首个工具决定；恢复只能接回这条正式事实，不能按名称重授权限。 */
export function resolveAuthorizedHostToolCall(
  request: HostToolCallRequestData | undefined,
  runId: RunId,
  history: readonly RuntimeEvent[]
): ToolContext['authorizedHostToolCall'] {
  if (!request) return undefined;
  const firstDecision = history.find(
    event => event.run_id === runId && event.type === 'tool_call_decision'
  );
  if (firstDecision?.type !== 'tool_call_decision' || firstDecision.tool_name !== request.tool_name)
    return undefined;
  return { toolName: request.tool_name, toolCallId: firstDecision.tool_call_id };
}
