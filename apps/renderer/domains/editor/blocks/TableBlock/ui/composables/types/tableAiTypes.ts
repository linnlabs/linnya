/**
 * @file apps/renderer/features/TableBlock/ui/composables/types/tableAiTypes.ts
 *
 * @brief 表格AI交互相关的TypeScript类型定义
 *
 * @description
 * 定义表格AI功能中使用的所有类型：
 * - AI状态类型
 * - 表格信息类型
 * - 列引用类型
 * - 输出区域类型
 * - 事件回调类型
 */

import type { ComputedRef } from 'vue';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

// === AI 状态相关类型 ===

/** AI处理状态 */
export interface AiProcessingState {
  /** 是否显示AI输入框 */
  showInput: boolean;
  /** 是否正在处理AI请求 */
  isProcessing: boolean;
  /** 是否已添加输出列 */
  outputColumnAdded: boolean;
  /** 是否正在重试（防止无限递归） */
  isRetrying: boolean;
}

/** AI输入位置 */
export interface AiInputPosition {
  top: number;
  left: number;
}

// === 表格信息相关类型 ===

/** 表格节点信息 */
export interface TableInfo {
  /** 表格节点 */
  node: ProseMirrorNode;
  /** 表格在文档中的位置 */
  pos: number;
  /**
   * 表格所在 rootBlock 的稳定 id。
   * @description
   * `pos` 会随着表格前方的文档改动漂移；虚拟化和侧边栏长流程应优先用 rootBlockId
   * 在最新 doc 中重新定位 table，再刷新 node/pos。
   */
  rootBlockId?: string | null;
  /**
   * （可选）本次 AI 流程中插入的列索引
   * @description
   * 用于“精确撤销列添加”等流程，避免在 store 中额外维护一份弱关联字段。
   */
  insertedColumnIndex?: number;
  /** anchor单元格位置 */
  anchorPos?: number;
  /** head单元格位置 */
  headPos?: number;
}

/** 表格矩形区域 */
export interface TableRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** 输出列矩形区域 */
export interface OutputRect extends TableRect {
  /** 是否为输出列 */
  isOutputColumn: true;
  /** 是否需要新增列 */
  needsNewColumn?: boolean;
}

// === 列引用相关类型 ===

/** 列引用信息 */
export interface ColumnRef {
  /** 引用键 */
  reference: string;
  /** 引用范围标识（如 'A' / 'A:C' / 'A1:C3'） */
  range: string;
  /** 显示名称 */
  name: string;
  /** 矩形区域 */
  rect: TableRect;
}

/** 活跃的列引用 */
export interface ActiveColumnRef {
  /** 是否激活 */
  active: boolean;
  /** 颜色 */
  color: string;
  /** 矩形区域 */
  rect: TableRect;
}

/** 活跃列引用集合 */
export type ActiveColumnRefs = Record<string, ActiveColumnRef>;

// === 目标列信息 ===

/** 目标列信息 */
export interface TargetColumn {
  /** 列索引 */
  index: number;
  /** 是否存在 */
  exists: boolean;
}

// === 编辑器相关类型 ===

/** 编辑器属性 */
export interface MergedEditorProps {
  editor: Editor | null;
}

/** 编辑器属性的计算引用 */
export type MergedEditorPropsRef = ComputedRef<MergedEditorProps>;

export interface TableAiInteraction {
  handleAIAction: (action: string) => Promise<void>;
}

/** useTableAiInteraction 参数 */
export interface UseTableAiInteractionOptions {
  /** 合并的编辑器属性 */
  mergedEditorProps: MergedEditorPropsRef;
  /** 隐藏工具栏的方法 */
  hideToolbar: () => void;
}
