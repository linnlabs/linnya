/**
 * Pending Revisions 相关工具的集中导出
 *
 * 职责：
 * - 作为「门面」模块，统一导出 Pending Revisions 强相关的工具与类型
 * - 调用方从 `./utils/pending` 导入所有内容，职责清晰
 * - 内部实现文件集中在本目录，高内聚低耦合
 */

// 批量编排入口
export * from './applyPendingRevisions'

// 类型定义
export * from './pendingRevisionTypes'

// 单条应用器
export * from './updatePendingRevisionApplier'
export * from './insertPendingRevisionApplier'
export * from './deletePendingRevisionApplier'

// 表格解析工具
export * from './pipeTableParser'


