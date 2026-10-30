import type { Node, Yoga, Edge } from 'yoga-layout/load';
import { measureGeneratedTextHeight } from '@plugin/slides/shared/generatedLayoutConstraints';
import type { GeneratedLayoutBox } from '@plugin/slides/shared/generatedLayoutConstraints';
import type { LayoutReplay, LayoutReplayStyle } from '@plugin/slides/shared/generatedLayoutReplay';

/** 同版本 Yoga、同配置、同测量输入重排当前页；每次释放节点，不维护第二份活动布局树。 */
export function computeLayoutReplay(yoga: Yoga, snapshot: LayoutReplay, widths: ReadonlyMap<string, number> = new Map()): ReadonlyMap<string, GeneratedLayoutBox> {
  const config = yoga.Config.create();
  config.setUseWebDefaults(true);
  config.setPointScaleFactor(0);
  const nodes: Node[] = [];
  try {
    for (const item of snapshot.nodes) {
      const node = yoga.Node.create(config);
      nodes.push(node);
      applyStyle(node, item.style, yoga);
      const width = widths.get(item.id);
      if (width !== undefined) node.setWidth(width * 72);
      const measurement = item.measurement;
      if (measurement?.kind === 'text' && (width !== undefined || measurement.wrap === 'word')) {
        if (measurement.wrap === 'none' && !measurement.explicitHeight) node.setHeightAuto();
        node.setMeasureFunc((available, mode) => {
          const inches = mode === yoga.MEASURE_MODE_UNDEFINED ? measurement.intrinsicWidth
            : mode === yoga.MEASURE_MODE_EXACTLY ? available / 72 : Math.min(measurement.intrinsicWidth, available / 72);
          return { width: inches * 72, height: measureGeneratedTextHeight(measurement.content, inches, { ...measurement, source: 'heuristic' }) * 72 };
        });
      }
    }
    // 绘制顺序可以被人工改层级，布局顺序仍使用编译时的原始兄弟次序。
    const childrenByParent = new Map<number, number[]>();
    snapshot.nodes.forEach((item, index) => {
      if (item.parent < 0) return;
      const children = childrenByParent.get(item.parent) ?? [];
      children.push(index);
      childrenByParent.set(item.parent, children);
    });
    for (const [parent, children] of childrenByParent) {
      children.sort((a, b) => snapshot.nodes[a].order - snapshot.nodes[b].order);
      children.forEach((index, childIndex) => nodes[parent].insertChild(nodes[index], childIndex));
    }
    nodes[0].calculateLayout(undefined, undefined, yoga.DIRECTION_LTR);
    const boxes = new Map<string, GeneratedLayoutBox>();
    for (const [index, item] of snapshot.nodes.entries()) {
      const node = nodes[index];
      const parent = item.parent < 0 ? undefined : boxes.get(snapshot.nodes[item.parent].id);
      boxes.set(item.id, { x: (parent?.x ?? 0) + node.getComputedLeft() / 72, y: (parent?.y ?? 0) + node.getComputedTop() / 72,
        w: node.getComputedWidth() / 72, h: node.getComputedHeight() / 72, unit: 'in' });
    }
    return boxes;
  } finally {
    // 每个节点单独释放，布局异常时也不会留下尚未挂到根上的 WASM 节点。
    nodes.forEach(node => node.free());
    config.free();
  }
}

function applyStyle(node: Node, style: LayoutReplayStyle, yoga: Yoga): void {
  const length = (value: string | number | undefined): number | 'auto' | `${number}%` | undefined =>
    typeof value === 'number' || value === undefined || value === 'auto' ? value : `${Number.parseFloat(value)}%`;
  node.setWidth(length(style.width)); node.setHeight(length(style.height));
  node.setMinWidth(style.minWidth); node.setMinHeight(style.minHeight); node.setMaxWidth(style.maxWidth); node.setMaxHeight(style.maxHeight);
  node.setFlexGrow(style.grow); node.setFlexShrink(style.shrink); node.setFlexBasis(length(style.basis));
  node.setFlexDirection(style.direction); node.setPositionType(style.positionType); node.setAlignItems(style.align); node.setJustifyContent(style.justify);
  const edges: Edge[] = [yoga.EDGE_LEFT, yoga.EDGE_TOP, yoga.EDGE_RIGHT, yoga.EDGE_BOTTOM, yoga.EDGE_START, yoga.EDGE_END, yoga.EDGE_HORIZONTAL, yoga.EDGE_VERTICAL, yoga.EDGE_ALL];
  edges.forEach((edge, index) => {
    const margin = length(style.margin[index] ?? undefined);
    const padding = length(style.padding[index] ?? undefined);
    const position = length(style.position[index] ?? undefined);
    if (margin !== undefined) node.setMargin(edge, margin);
    if (padding !== undefined && padding !== 'auto') node.setPadding(edge, padding);
    if (position !== undefined && position !== 'auto') node.setPosition(edge, position);
  });
  node.setGap(yoga.GUTTER_ALL, style.gap);
}
