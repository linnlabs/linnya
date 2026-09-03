import type { AgentDefinition } from './types';
import { getRegisteredAgentDefinitions } from 'src/app-hosts/linnya/plugin-registry/builtin';

export function listRegisteredAgentDefinitions(): AgentDefinition[] {
  return getRegisteredAgentDefinitions();
}

export function findRegisteredAgentDefinitionByPromptKey(promptKey: string): AgentDefinition | undefined {
  return listRegisteredAgentDefinitions().find((definition) => definition.promptKey === promptKey);
}

export function findRegisteredAgentDefinitionById(agentId: string): AgentDefinition | undefined {
  return listRegisteredAgentDefinitions().find((definition) => definition.id === agentId);
}

export function listRegisteredAgentPromptKeys(): string[] {
  return listRegisteredAgentDefinitions().map((definition) => definition.promptKey);
}
