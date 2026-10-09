import { readToolContextWorkingHistory } from '@linnlabs/linnkit/runtime-kernel';
import type { ToolContext } from 'src/tools/types';

/** 根与 child 共享拒绝规则；只有原始 Host 调用拥有目录外的单次例外。 */
export function checkRegisteredToolExecutionScope(toolName: string, context: ToolContext) {
  const childScope = context.registeredChildAllowedTools;
  const allowedTools = childScope ?? context.registeredRootAllowedTools;
  if (allowedTools === undefined || allowedTools.includes(toolName)) return undefined;

  const hostCall = context.authorizedHostToolCall;
  if (
    childScope === undefined &&
    hostCall?.toolName === toolName &&
    hostCall.toolCallId === context.parentToolCallId &&
    !readToolContextWorkingHistory(context).some(
      event =>
        event.type === 'tool_output' &&
        event.tool_call_id === hostCall.toolCallId &&
        event.run_id === context.runId
    )
  )
    return undefined;

  return childScope === undefined
    ? {
        errorCode: 'REGISTERED_ROOT_TOOL_NOT_ALLOWED',
        error: `当前根运行未获准调用工具 '${toolName}'`,
      }
    : {
        errorCode: 'REGISTERED_CHILD_TOOL_NOT_ALLOWED',
        error: `当前子运行未获准调用工具 '${toolName}'`,
      };
}
