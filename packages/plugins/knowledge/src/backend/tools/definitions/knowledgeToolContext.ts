/** 可选图谱策略属于知识库；项目、run、abort 仍使用原 Host 工具上下文对象。 */

import type { ToolContext as PluginToolContext } from '@plugin/backend/toolRuntime';
import type { GraphBudget, GraphMode } from '../../graph/application/graphBudget';

export interface KnowledgeToolContext extends PluginToolContext {
  readonly graphMode?: GraphMode;
  readonly graphBudget?: Partial<GraphBudget>;
}
