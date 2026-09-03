/**
 * @file toolRuntime.ts
 * @description 插件后端工具运行时契约门面。
 *
 * 中文说明：
 * - 插件工具仍运行在 Linnya host 内，但包内不再 deep import host 内部工具目录；
 * - 这里只暴露 Tool 基类、上下文、结构化结果与子 agent runner 这些工具运行所需的稳定能力。
 */

import type {
  RunRegisteredSubagentParams,
  RunRegisteredSubagentResult,
  RunRegisteredSubagentsInParallelParams,
} from 'src/tools/agent_control/subrun/shared';
import type {
  PluginToolContext,
} from '@linnya/plugin-host-contract/backend/toolRuntime';

export {
  BaseTool,
} from 'src/tools/types';
export type {
  PluginBaseToolConstructor,
  PluginDatabaseServicePort,
  PluginDocumentSoT,
  PluginKnowledgeBaseServicePort,
  PluginSqliteDatabasePort,
  PluginSqliteStatementPort,
  PluginSqliteTransactionPort,
  PluginStructuredToolResult,
  PluginToolContext,
  PluginWorkspaceProjectMetadata,
  PluginWorkspaceServicePort,
  StructuredToolResult,
  ToolContext,
  ToolParameterProperty,
  ToolParameterSchema,
} from '@linnya/plugin-host-contract/backend/toolRuntime';
export type {
  RunRegisteredSubagentParams,
  RunRegisteredSubagentResult,
  RunRegisteredSubagentsInParallelParams,
} from 'src/tools/agent_control/subrun/shared';

export async function runRegisteredSubagent(
  params: RunRegisteredSubagentParams,
): Promise<RunRegisteredSubagentResult> {
  const runner = await import('src/tools/agent_control/subrun/shared');
  return runner.runRegisteredSubagent(params);
}

export async function runRegisteredSubagentsInParallel(
  params: RunRegisteredSubagentsInParallelParams,
): Promise<RunRegisteredSubagentResult[]> {
  const runner = await import('src/tools/agent_control/subrun/shared');
  return runner.runRegisteredSubagentsInParallel(params);
}

export type HostToolContext = import('src/tools/types').ToolContext;

type HostToolContextSatisfiesPluginContract = HostToolContext extends PluginToolContext ? true : never;

const _hostToolContextSatisfiesPluginContract: HostToolContextSatisfiesPluginContract = true;
void _hostToolContextSatisfiesPluginContract;
