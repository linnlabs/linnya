/**
 * @file src/app-hosts/linnya/agent-registry/builtin/index.ts
 * @description 内置 AgentRegistry 初始化入口
 *
 * 使用方式：
 * - Flow 链路在启动时（或首次请求时）调用一次 ensureBuiltinAgentIntegrationsRegistered()
 * - 后续请求不需要重复 import/register 具体业务 extender/enricher
 */

import type { AgentRegistryDependencies } from '../types';
import { agentRegistry } from '../registry';
import { getBuiltinAgentDefinitions } from './builtin-agent-definitions';
import { ensurePluginSkillAvailabilityRegistered } from '../../plugin-registry/skillAvailability';

let builtinRegistered = false;

function ensureBuiltinDefinitionsRegistered(): void {
  if (builtinRegistered) return;
  for (const def of getBuiltinAgentDefinitions()) {
    agentRegistry.register(def);
  }
  builtinRegistered = true;
}

/**
 * 确保内置 AgentDefinition 已注册，并注册所有 HistoryBuilder 扩展器
 *
 * 说明：
 * - 这是"收口入口"：主链路只依赖这个函数
 * - 注册是幂等的：多次调用不会重复注册
 */
export function ensureBuiltinHistoryBuilderExtendersRegistered(): void {
  ensureBuiltinDefinitionsRegistered();
  agentRegistry.registerHistoryBuilderExtenders();
}

/**
 * 确保内置 AgentDefinition 已注册，并注册所有 RequestEnricher
 *
 * 说明：
 * - 需要 deps（例如 databaseService）用于构造业务 enricher
 * - 注册幂等：registry 层按 enricher.name 去重
 */
export function ensureBuiltinRequestEnrichersRegistered(deps: AgentRegistryDependencies): void {
  ensureBuiltinDefinitionsRegistered();
  ensurePluginSkillAvailabilityRegistered();
  agentRegistry.registerRequestEnrichers(deps);
}
