import type { AgentInvokeRequest } from '../context/agent/contracts';
import { findRegisteredAgentDefinitionByPromptKey } from './agentDefinitionResolver';
import { getAgentTask } from './agentTaskResolver';

/** 物化 task 的真实系统消息；不散落调用 prompt builder，也不在恢复时重新查询动态输入。 */
export function freezeAgentRunInput(request: AgentInvokeRequest): AgentInvokeRequest {
  const definition = findRegisteredAgentDefinitionByPromptKey(request.promptKey);
  if (!definition) throw new Error(`Agent definition unavailable: ${request.promptKey}`);
  const task = getAgentTask(request.promptKey);
  if (!('supportsFrozenSystemPrompt' in task) || task.supportsFrozenSystemPrompt !== true) {
    throw new Error(`Agent task does not support frozen run inputs: ${definition.id}`);
  }
  const systemMessages = task
    .buildMessages(request, [])
    .filter(message => message.role === 'system' && message.type === 'system_prompt');
  if (systemMessages.length !== 1 || typeof systemMessages[0]?.content !== 'string') {
    throw new Error(`Agent task must expose one textual system prompt: ${definition.id}`);
  }
  return { ...request, frozenSystemPrompt: systemMessages[0].content };
}
