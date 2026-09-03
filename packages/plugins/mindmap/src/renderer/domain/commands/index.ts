/**
 * MindMap 命令体系 — 导出入口
 *
 * @module domain/commands
 */

// 类型导出
export type {
  CommandSource,
  CommandMeta,
  CommandContext,
  CommandResult,
  CommandFailReason,
  CommandName,
  CommandDef,
  OperationMeta,
  MindMapCommands,
  MindMapCan,
  RunCommand,
} from './types'

// 注册表与安装
export {
  registerCommand,
  getCommandDef,
  hasCommand,
  installMindMapCommands,
  getContextManager,
  getActiveCommandContext,
} from './registry'

// 上下文管理（内部使用，但需要导出给 reflow wrapper）
export {
  CommandContextManager,
  generateTxId,
  fillDefaultMeta,
  COMMAND_CONTEXT_MANAGER_KEY,
} from './internal/commandContext'

// 日志配置
export {
  setCommandLoggerConfig,
  getCommandLoggerConfig,
} from './internal/commandLogger'

// ============================================================================
// Normalize — 输入归一化（WP2）
// ============================================================================

export {
  // Topic[] 归一化
  dedupeTopics,
  filterRootTopics,
  collapseDirectParentChild,
  collapseAncestorChain,
  normalizeTopicsForRemove,
  normalizeTopicsBasic,
  // nodeId[] 归一化
  dedupeNodeIds,
  filterEmptyNodeIds,
  isRootNodeId,
  findNodeObjById,
  normalizeNodeIdsForRemove,
  normalizeNodeIdsBasic,
  // 工具函数
  hasRootInTopics,
  hasRootInNodeIds,
  topicsToNodeIds,
} from './normalize'

// ============================================================================
// Guards — 守卫（WP2）
// ============================================================================

export type { GuardResult, GuardPass, GuardFail } from './guards'

export {
  // 结果构造
  pass,
  fail,
  // 文档上下文守卫
  requireDocumentReady,
  // 选区守卫
  requireSelectionNonEmpty,
  requireCurrentNode,
  // Root 守卫
  forbidRootTopic,
  forbidRootNodeId,
  forbidRootInSelection,
  forbidRootInNodeIds,
  // 节点存在性守卫
  requireNodeExists,
  requireAllNodesExist,
  // Payload 守卫
  requirePayload,
  requireValidNodeId,
  requireValidNodeIds,
  // 组合守卫
  all,
  allLazy,
  // 预设组合
  guardsForRemoveSelected,
  guardsForRemoveByIds,
  guardsForSingleNode,
  guardsForSingleNodeAllowRoot,
} from './guards'

// ============================================================================
// Commands — 命令实现（WP3）
// ============================================================================

export { registerAllCommands } from './commands'

// Payload 类型导出
export type {
  SelectPayload,
  SelectManyPayload,
  RemoveByIdsPayload,
  AddChildPayload,
  InsertSiblingPayload,
  InsertParentPayload,
  ToggleExpandPayload,
  ReflowRequestPayload,
  ReflowFlushNowPayload,
  FlushNowReason,
} from './commands'
