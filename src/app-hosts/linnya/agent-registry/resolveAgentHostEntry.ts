import { HostToolCallRequest, type HostToolCallRequestData } from '@app/schemas';
import type { AgentInvokeRequest } from '../context/agent/contracts';
import { findRegisteredAgentDefinitionByPromptKey } from './agentDefinitionResolver';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';

/** Host 只接纳声明的入口；具体参数的默认值、校验和业务含义归 definition 的用例。 */
export function resolveAgentHostEntry(
  request: AgentInvokeRequest,
  explicit?: HostToolCallRequestData,
  history: readonly RuntimeEvent[] = []
): HostToolCallRequestData | undefined {
  const entry = findRegisteredAgentDefinitionByPromptKey(request.promptKey)?.hostEntry;
  if (!entry) return explicit;
  if (explicit && explicit.tool_name !== entry.toolName) {
    throw new Error(
      `Agent ${request.promptKey} requires its declared Host entry ${entry.toolName}`
    );
  }
  if (explicit?.completion_mode && explicit.completion_mode !== 'yield_after_batch') {
    throw new Error(`Agent ${request.promptKey} Host entry must yield after its tool completes`);
  }
  return HostToolCallRequest.parse({
    tool_name: entry.toolName,
    args: entry.resolveArgs(request, explicit?.args, history),
    completion_mode: 'yield_after_batch',
  });
}
