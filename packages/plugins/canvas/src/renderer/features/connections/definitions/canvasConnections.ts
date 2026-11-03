import type { CanvasEdge, CanvasEndpoint, CanvasPoint } from '@plugin/canvas/shared';
import type { CanvasKernel } from '../../../kernel';
export type CanvasConnectionKernel = Pick<CanvasKernel, 'canvas' | 'screenToWorld' | 'hitTest' | 'setSelectedEdge' | 'readEdgeGeometry'>;
export interface CanvasConnectionPreview { readonly from: CanvasPoint; readonly to: CanvasPoint }
export interface CanvasEndpointGesture {
  readonly pointer: number; readonly target: HTMLElement; readonly edge: CanvasEdge | null;
  readonly field: 'from' | 'to'; readonly from: CanvasEndpoint; readonly origin: CanvasPoint;
  readonly screen: CanvasPoint;
}
