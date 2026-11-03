import type { CanvasEdge, CanvasEndpoint, CanvasPoint } from '@plugin/canvas/shared';
import type { CanvasKernel } from '../../../kernel';
export type CanvasConnectionKernel = Pick<CanvasKernel, 'canvas' | 'screenToWorld' | 'hitTest' | 'readCamera' | 'visibleCards' | 'setSelectedEdge' | 'readEdgeGeometry'>;
export interface CanvasConnectionPreview { readonly from: CanvasPoint; readonly to: CanvasPoint }
export interface CanvasEndpointGesture {
  readonly pointer: number; readonly target: HTMLElement; readonly edge: CanvasEdge | null;
  readonly field: 'from' | 'to'; readonly from: CanvasEndpoint; readonly origin: CanvasPoint;
  readonly screen: CanvasPoint;
}
export type CanvasEndpointStart = { readonly event: PointerEvent; readonly from: CanvasEndpoint; readonly origin: CanvasPoint }
  & ({ readonly kind: 'create' } | { readonly kind: 'reattach'; readonly edge: CanvasEdge; readonly field: 'from' | 'to' });
