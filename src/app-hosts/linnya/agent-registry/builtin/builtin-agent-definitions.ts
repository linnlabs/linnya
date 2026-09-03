/**
 * @file src/app-hosts/linnya/agent-registry/builtin/builtin-agent-definitions.ts
 * @description 内置 AgentDefinition 清单
 *
 * 约定：
 * - Agent 定义统一来自 src/app-hosts/linnya/agent-registry/agents/<agent>/index.ts
 *   并由 `src/app-hosts/linnya/agent-registry/agents/index.ts` 统一聚合（与 tools 的 index.ts 模式一致）
 */

import type { AgentDefinition } from '../types';
import { getAllRegisteredAgentDefinitionsForStaticCatalog } from 'src/app-hosts/linnya/plugin-registry/builtin';
import { validateSkillExposureConfig } from 'src/features/skills/agentSkillExposure';

/**
 * 当前阶段：AgentDefinition 已全部收口到 agents/<agent> 目录；
 * single_turn 能力通过 tools-disabled agent 表达，不再保留 chat 注册表。
 *
 * 中文说明：
 * - 这里延迟读取静态定义清单，只读取“插件能贡献什么”；
 * - 运行期“哪些插件已启用”依赖数据库注入，必须留给 AgentDefinitionResolver 在请求时判断。
 */
export function getBuiltinAgentDefinitions(): AgentDefinition[] {
  // 中文说明：开发环境会在 App Server bootstrap 前注入用户插件目录，但此时应用版本
  // 尚未进入 Backend，不能在模块加载期提前执行插件兼容性校验。调用方必须等数据库
  // bootstrap 完成插件 lifecycle 后再读取完整定义清单。
  const registeredAgentDefinitions = getAllRegisteredAgentDefinitionsForStaticCatalog();
  validateSkillExposureConfig(registeredAgentDefinitions);
  return [...registeredAgentDefinitions];
}
