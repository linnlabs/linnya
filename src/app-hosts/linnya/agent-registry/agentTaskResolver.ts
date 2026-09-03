import * as contextManager from 'linnkit/context-manager';
import { GenericAgentTask } from 'src/app-hosts/linnya/agent-registry/GenericAgentTask';
import type { AgentDefinition } from 'src/app-hosts/linnya/agent-registry/types';
import {
  findRegisteredAgentDefinitionByPromptKey,
  listRegisteredAgentPromptKeys,
} from './agentDefinitionResolver';
import { pluginDiagnostics } from '../plugin-registry/diagnostics';

const registryTaskCache = new Map<string, contextManager.agentTasks.IAgentTask>();

export function clearRegisteredAgentTaskCache(): void {
  registryTaskCache.clear();
}

function findAgentDefinitionByPromptKey(promptKey: string): AgentDefinition | undefined {
  return findRegisteredAgentDefinitionByPromptKey(promptKey);
}

function getRegistryTask(promptKey: string): contextManager.agentTasks.IAgentTask | null {
  const def = findAgentDefinitionByPromptKey(promptKey);
  if (!def) return null;

  const cached = registryTaskCache.get(promptKey);
  if (cached) return cached;

  const custom = def.task?.customTaskClass;
  const task = custom ? new custom() : new GenericAgentTask(def);
  registryTaskCache.set(promptKey, task);
  return task;
}

export function getAgentTask(promptKey: string): contextManager.agentTasks.IAgentTask {
  const task = getRegistryTask(promptKey);
  if (task) return task;

  const message =
    `[AgentTaskRegistry] 未找到 promptKey='${promptKey}' 的 AgentDefinition。` +
    `请检查是否已在 app-host agent registry 中注册。` +
    `已注册的 key: [${listRegisteredAgentPromptKeys().join(', ')}]`;
  pluginDiagnostics.record({
    level: 'error',
    pluginId: null,
    capability: 'agent',
    message,
  });
  throw new Error(message);
}
