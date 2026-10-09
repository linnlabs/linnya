import type { AgentInvokeRequest } from '../context/agent/contracts';
import { findRegisteredAgentDefinitionByPromptKey } from './agentDefinitionResolver';
import type { AgentRequestAdmissionContext } from './types';

/** 业务接纳规则归 Agent definition；Flow 只负责提供首次接纳的正式上下文。 */
export function resolveAgentRequestAdmission(
  request: AgentInvokeRequest,
  context: AgentRequestAdmissionContext
): AgentInvokeRequest {
  const admit = findRegisteredAgentDefinitionByPromptKey(request.promptKey)?.requestAdmission;
  return admit ? admit(request, context) : request;
}
