import type { AgentDefinition } from './types';
import {
  getAllRegisteredAgentDefinitionsForStaticCatalog,
  getRegisteredAgentDefinitions,
} from 'src/app-hosts/linnya/plugin-registry/builtin';

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

/**
 * 声明为 `internal` 的 Agent ID。按全部已注册定义计算，不看插件是否启用：
 * 插件停用后，它留在对话里的内部运行仍不算对话的 Agent。
 */
export function listInternalAgentIds(): ReadonlySet<string> {
  return new Set(
    getAllRegisteredAgentDefinitionsForStaticCatalog()
      .filter(definition => definition.internal === true)
      .map(definition => definition.id)
  );
}
