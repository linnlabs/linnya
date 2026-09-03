/**
 * @file MindMap 右键菜单：类型定义
 *
 * 中文说明：
 * - 把菜单的类型从 SFC 中抽离，便于复用与后续拆分；
 * - 这里不引入任何运行时依赖，纯类型与轻量约束。
 */

import type { Component } from 'vue'

/**
 * 右键菜单的动作枚举（value 字段）
 *
 * 说明：
 * - 该 union 既包含 MindMap 内部操作（新增/删除/打标等），也包含 AI 运行入口；
 * - 该类型同时作为 `CustomSelect` 的 option value，因此应保持稳定。
 */
export type MenuAction =
  | 'add_child'
  | 'remove_node'
  | 'add_evidence'
  // ---------------------------------------------------------------------
  // AI 动作（右键入口）
  // ---------------------------------------------------------------------
  /**
   * 深度分析（仅根节点显示）
   *
   * 中文说明：
   * - 入口语义：对整张图（以根节点为锚点）执行“拆解→提假设→验假设”的强制工作流；
   * - 对应后端 promptKey：mindmap_workflow_leader
   */
  | 'deep_analysis'
  | 'decompose_question'
  | 'validate_hypothesis'
  | 'propose_hypothesis'
  // ---------------------------------------------------------------------
  // 其它操作（保留扩展位）
  // ---------------------------------------------------------------------
  | 'focus'
  | 'unfocus'
  | 'move_up'
  | 'move_down'
  | 'summary'
  | 'link'
  | 'link_bidirectional'
  // ---------------------------------------------------------------------
  // 节点类型打标
  // ---------------------------------------------------------------------
  | 'set_kind_hypothesis'
  | 'set_kind_question'
  | 'set_kind_conclusion'
  | 'clear_kind'
  // ---------------------------------------------------------------------
  // 状态打标
  // ---------------------------------------------------------------------
  | 'set_status_open'
  | 'set_status_verified'
  | 'set_status_refuted'
  | 'set_status_closed'
  | 'clear_status'
  // ---------------------------------------------------------------------
  // 置信度打标
  // ---------------------------------------------------------------------
  | 'set_confidence_high'
  | 'set_confidence_medium'
  | 'set_confidence_low'
  | 'clear_confidence'

/**
 * 菜单项数据结构（与 CustomSelect 组件 options 口径对齐）
 */
export type MenuItem =
  | { isSeparator: true }
  | { isGroup: true; label: string }
  | {
      text: string
      value: MenuAction
      shortcut?: string
      disabled?: boolean
      variant?: 'danger'
      /**
       * 右侧图标（例如：AI 标识）
       *
       * 中文说明：
       * - 该字段只影响渲染，不参与选择/交互逻辑；
       * - 由 `CustomSelect` 负责把它渲染在菜单项右侧。
       */
      rightIconComponent?: Component
      children?: MenuItem[]
    }
