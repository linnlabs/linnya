import type { TextWrapPolicy } from '@plugin/slides/shared';
import type { FlexProps, LayoutTextNode } from './LayoutTypes.js';

/**
 * 没有横向约束的绝对定位 Text 对应 PowerPoint 的点击输入文本框：
 * 盒子跟随内容宽度，只保留作者显式写下的换行。其余 Text 均由 width 或
 * Flex 布局提供横向约束，使用正常自动换行。
 */
export function resolveLayoutTextWrapPolicy(node: LayoutTextNode): TextWrapPolicy {
  return isUnconstrainedAbsoluteText(node) ? 'none' : 'word';
}

function isUnconstrainedAbsoluteText(node: LayoutTextNode): boolean {
  if (!isAbsolutelyPositioned(node) || hasExplicitWidth(node)) {
    return false;
  }

  const hasLeftEdge = node.left != null || node.x != null;
  return !(hasLeftEdge && node.right != null) && node.maxWidth == null;
}

function isAbsolutelyPositioned(props: FlexProps): boolean {
  return props.position === 'absolute'
    || typeof props.position === 'object'
    || props.top != null
    || props.right != null
    || props.bottom != null
    || props.left != null
    || props.x != null
    || props.y != null;
}

function hasExplicitWidth(props: FlexProps): boolean {
  return props.width != null
    || props.w != null
    || (typeof props.position === 'object' && props.position.w != null);
}
