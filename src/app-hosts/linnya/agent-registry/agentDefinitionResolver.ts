import type { AgentConfiguration, AgentDefinition, AgentRecoveryIdentity } from './types';
import { resolveLegacyResearchConfiguration } from './agents/research_v1/legacyCompatibility';
import { getRegisteredAgentDefinitions } from 'src/app-hosts/linnya/plugin-registry/builtin';

export function listRegisteredAgentDefinitions(): AgentDefinition[] {
  return getRegisteredAgentDefinitions();
}

export function findRegisteredAgentDefinitionByPromptKey(
  promptKey: string
): AgentDefinition | undefined {
  return listRegisteredAgentDefinitions().find(definition => definition.promptKey === promptKey);
}

export function findRegisteredAgentDefinitionById(agentId: string): AgentDefinition | undefined {
  return listRegisteredAgentDefinitions().find(definition => definition.id === agentId);
}

export function listRegisteredAgentPromptKeys(): string[] {
  return listRegisteredAgentDefinitions().map(definition => definition.promptKey);
}

/** 恢复只读取 owner 明确维护的历史配置；未声明的身份仍使用当前定义参与严格比较。 */
export function resolveRegisteredAgentRecoveryConfiguration(
  definition: AgentDefinition,
  identity: AgentRecoveryIdentity
): AgentConfiguration {
  return resolveLegacyResearchConfiguration(identity) ?? definition.config ?? {};
}
