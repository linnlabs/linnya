import type { Node, Yoga } from 'yoga-layout/load';
import type { LayoutReplayStyle } from '@plugin/slides/shared/generatedLayoutReplay';

/** 读取真正送入 Yoga 的归一化样式，不在 Renderer 再解释一遍作者 DSL。 */
export function readYogaReplayStyle(node: Node, yoga: Yoga): LayoutReplayStyle {
  const length = (value: ReturnType<Node['getWidth']>): number | 'auto' | `${number}%` | undefined => {
    if (value.unit === yoga.UNIT_POINT) return value.value;
    if (value.unit === yoga.UNIT_PERCENT) return `${value.value}%`;
    if (value.unit === yoga.UNIT_AUTO) return 'auto';
    return undefined;
  };
  const numeric = (value: ReturnType<Node['getWidth']>) => value.unit === yoga.UNIT_POINT ? value.value : undefined;
  // Yoga 3.2.1 的声明把 getGap 写成 Value，实际绑定返回 number（未声明时为 NaN）。
  const gap: unknown = node.getGap(yoga.GUTTER_ALL);
  const edges = (read: Node['getMargin']): LayoutReplayStyle['margin'] => [
    length(read(yoga.EDGE_LEFT)) ?? null, length(read(yoga.EDGE_TOP)) ?? null, length(read(yoga.EDGE_RIGHT)) ?? null, length(read(yoga.EDGE_BOTTOM)) ?? null,
    length(read(yoga.EDGE_START)) ?? null, length(read(yoga.EDGE_END)) ?? null, length(read(yoga.EDGE_HORIZONTAL)) ?? null, length(read(yoga.EDGE_VERTICAL)) ?? null, length(read(yoga.EDGE_ALL)) ?? null,
  ];
  return { width: length(node.getWidth()), height: length(node.getHeight()),
    minWidth: numeric(node.getMinWidth()), minHeight: numeric(node.getMinHeight()), maxWidth: numeric(node.getMaxWidth()), maxHeight: numeric(node.getMaxHeight()),
    grow: node.getFlexGrow(), shrink: node.getFlexShrink(), basis: length(node.getFlexBasis()),
    direction: node.getFlexDirection(), positionType: node.getPositionType(), align: node.getAlignItems(), justify: node.getJustifyContent(),
    margin: edges(node.getMargin.bind(node)), padding: edges(node.getPadding.bind(node)), position: edges(node.getPosition.bind(node)), gap: typeof gap === 'number' && Number.isFinite(gap) ? gap : undefined,
  };
}
