/**
 * @file types.ts
 * @description 编辑器核心类型定义
 */

import type { Ref } from 'vue'

/**
 * Layout Manager 类型（暂时使用 unknown，待具体实现时补充）
 */
export type LayoutManager = unknown

/**
 * 扩展依赖接口
 * 使用通用类型，避免直接依赖其他模块的具体实现
 */
export interface ExtensionDependencies {
  layoutManagerInstance: Ref<LayoutManager>
  findReplaceStore: unknown
}
