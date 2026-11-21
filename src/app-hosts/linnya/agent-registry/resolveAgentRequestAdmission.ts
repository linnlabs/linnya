import type { AgentInvokeRequest } from '../context/agent/contracts';
import { findRegisteredAgentDefinitionByPromptKey } from './agentDefinitionResolver';
import type { AgentRequestAdmissionContext } from './types';

/** 业务接纳规则归 Agent definition；Flow 提供首次接纳的正式上下文，上下文估算以 `contextEstimate` 只读复用。 */
export function resolveAgentRequestAdmission(
  request: AgentInvokeRequest,
  context: AgentRequestAdmissionContext
): AgentInvokeRequest {
  const admit = findRegisteredAgentDefinitionByPromptKey(request.promptKey)?.requestAdmission;
  return admit ? admit(request, context) : request;
}
