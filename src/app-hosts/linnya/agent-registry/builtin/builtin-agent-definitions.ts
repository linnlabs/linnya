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
 * - 这里是模块加载期的静态定义清单，只能读取“插件能贡献什么”；
 * - 运行期“哪些插件已启用”依赖数据库注入，必须留给 AgentDefinitionResolver 在请求时判断。
 */
const registeredAgentDefinitions = getAllRegisteredAgentDefinitionsForStaticCatalog();
validateSkillExposureConfig(registeredAgentDefinitions);

export const BUILTIN_AGENT_DEFINITIONS: AgentDefinition[] = [
  ...registeredAgentDefinitions,
];
