import { findRegisteredAgentDefinitionByPromptKey } from './agentDefinitionResolver';

/** 只用于首次接纳；恢复必须保留原 descriptor，不能把已停用入口改成其它 Agent。 */
export function assertAgentNewRunAvailable(promptKey: string): void {
  const reason = findRegisteredAgentDefinitionByPromptKey(promptKey)?.newRunUnavailableReason;
  if (reason !== undefined) throw new AgentNewRunUnavailableError(reason);
}

export class AgentNewRunUnavailableError extends Error {
  readonly code = 'AGENT_NEW_RUN_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'AgentNewRunUnavailableError';
  }
}
