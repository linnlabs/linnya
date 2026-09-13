import type { RenderNode, RenderNodeKind } from '../../../types/render';

export interface RenderNodeSelectionPoint {
  readonly x: number;
  readonly y: number;
}

export interface RenderNodeSelectionRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 可见 RenderNode 的世界坐标选择几何；不携带具体业务的可编辑权限。 */
export interface RenderNodeSelectionGeometry<
  TNode extends RenderNode = RenderNode,
> {
  readonly elementId: string;
  readonly nodeKind: RenderNodeKind;
  readonly node: TNode;
  readonly bounds: RenderNodeSelectionRect;
  readonly polygon: readonly RenderNodeSelectionPoint[];
  readonly zPath: readonly number[];
}
