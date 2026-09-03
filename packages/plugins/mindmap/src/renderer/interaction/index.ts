/**
 * MindMap 交互层 — 统一导出
 *
 * 中文说明：
 * - 聚合 selection/intents/keyboard 子模块
 * - 作为交互层的对外入口
 *
 * @module interaction
 */

// Selection 模块
export * from './selection/actions/nodeActions'

// Intent 体系（Phase 2）
export * from './intents'

// 键盘系统（Phase 2）
export * from './keyboard'
