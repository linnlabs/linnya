import {
  DEFAULT_WORKSPACE_TABLE_STYLE,
  WORKSPACE_TABLE_STYLE_ATTRIBUTE,
  WORKSPACE_TABLE_STYLES,
  type WorkspaceTableStyle,
} from '../definitions/workspaceTable';

const STYLES: ReadonlySet<string> = new Set(WORKSPACE_TABLE_STYLES);

export function isWorkspaceTableStyle(value: unknown): value is WorkspaceTableStyle {
  return typeof value === 'string' && STYLES.has(value);
}

/** 呈现时读取样式：缺失或无法识别的值按默认样式显示。持久化校验在正式 schema 里拒绝非法值。 */
export function readWorkspaceTableStyle(value: unknown): WorkspaceTableStyle {
  return isWorkspaceTableStyle(value) ? value : DEFAULT_WORKSPACE_TABLE_STYLE;
}

/** 渲染到 table 元素的属性：默认样式不输出任何属性。 */
export function workspaceTableStyleAttributes(value: unknown): Record<string, string> {
  const style = readWorkspaceTableStyle(value);
  return style === DEFAULT_WORKSPACE_TABLE_STYLE ? {} : { [WORKSPACE_TABLE_STYLE_ATTRIBUTE]: style };
}

/** NodeView 等直接持有 table 元素的宿主同步样式属性。 */
export function applyWorkspaceTableStyle(table: Element, value: unknown): void {
  const style = readWorkspaceTableStyle(value);
  if (style === DEFAULT_WORKSPACE_TABLE_STYLE) table.removeAttribute(WORKSPACE_TABLE_STYLE_ATTRIBUTE);
  else if (table.getAttribute(WORKSPACE_TABLE_STYLE_ATTRIBUTE) !== style) table.setAttribute(WORKSPACE_TABLE_STYLE_ATTRIBUTE, style);
}
