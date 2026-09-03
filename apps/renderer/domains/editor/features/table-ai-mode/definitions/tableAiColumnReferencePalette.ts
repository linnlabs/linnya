/**
 * 列引用颜色按当前表格上下文中的列顺序稳定分配。
 * 颜色属于 Table AI 的呈现契约，不应由跨会话的全局状态持有。
 */
export const TABLE_AI_COLUMN_REFERENCE_COLORS = [
  '#66BB6A',
  '#AB47BC',
  '#42A5F5',
  '#FF7043',
  '#EC407A',
  '#5C6BC0',
  '#9CCC65',
  '#78909C',
] as const;
