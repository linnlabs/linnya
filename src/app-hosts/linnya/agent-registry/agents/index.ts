/**
 * @file src/app-hosts/linnya/agent-registry/agents/index.ts
 * @description AgentDefinition 测试/诊断聚合入口
 *
 * 中文说明：
 * - 插件化后，运行期解析应走 AgentDefinitionResolver / BackendPluginRegistry；
 * - 这里导出的全量清单不读取 enabled 状态，只能用于测试、诊断和静态配置校验。
 */

import { getAllRegisteredAgentDefinitionsForStaticCatalog } from '../../plugin-registry/builtin';

export const ALL_AGENT_DEFINITIONS_FOR_TESTS = getAllRegisteredAgentDefinitionsForStaticCatalog();
