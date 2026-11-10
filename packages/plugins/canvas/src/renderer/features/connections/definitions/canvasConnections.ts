import type {
  CanvasCamera,
  CanvasCard,
  CanvasEdge,
  CanvasEdgeId,
  CanvasEndpoint,
  CanvasPatch,
  CanvasPoint,
} from '@plugin/canvas/shared';
import type { CanvasKernel } from '../../../kernel';
import type { Ref } from 'vue';
import type { CanvasDocumentSession } from '../../canvasDocument';
export type CanvasConnectionKernel = Pick<
  CanvasKernel,
  | 'canvas'
  | 'screenToWorld'
  | 'hitTest'
  | 'readCamera'
  | 'visibleCards'
  | 'setHoveredCard'
  | 'setSelectedEdge'
  | 'readEdgeGeometry'
>;
export interface CanvasConnectionPreview {
  readonly from: CanvasPoint;
  readonly to: CanvasPoint;
  readonly target?: CanvasCard | null;
}
export interface CanvasEndpointGesture {
  readonly pointer: number;
  readonly target: HTMLElement;
  readonly edge: CanvasEdge | null;
  readonly field: 'from' | 'to';
  readonly from: CanvasEndpoint;
  readonly origin: CanvasPoint;
  readonly screen: CanvasPoint;
}
export type CanvasEndpointStart = {
  readonly event: PointerEvent;
  readonly from: CanvasEndpoint;
  readonly origin: CanvasPoint;
} & (
  | { readonly kind: 'create' }
  | { readonly kind: 'reattach'; readonly edge: CanvasEdge; readonly field: 'from' | 'to' }
);
export interface CanvasConnectionLabelDraft {
  readonly edge: CanvasEdge;
  readonly value: string;
  readonly identity: string;
  readonly editSequence: number;
}
export interface CanvasConnectionState {
  readonly selectedId: Readonly<Ref<CanvasEdgeId | null>>;
  readonly label: Readonly<Ref<CanvasConnectionLabelDraft | null>>;
  readonly preview: Readonly<Ref<CanvasConnectionPreview | null>>;
  select(id: CanvasEdgeId | null): void;
  beginLabel(edge: CanvasEdge): void;
  updateLabel(value: string): void;
  endLabel(): void;
  setPreview(value: CanvasConnectionPreview | null): void;
}
export interface CanvasEndpointGestureOptions {
  readonly session: CanvasDocumentSession;
  readonly kernel: CanvasConnectionKernel;
  readonly state: CanvasConnectionState;
  readonly report: (failure: unknown) => void;
  readonly createText: (point: CanvasPoint, from: CanvasEndpoint) => Promise<void>;
  /** 连线圆点离卡片几何边的内缩距离（世界坐标），命中判定与画出的圆点同心。 */
  readonly anchorInset: (zoom: number) => number;
}
export interface CanvasEndpointCommitInput {
  readonly session: CanvasDocumentSession;
  readonly gesture: CanvasEndpointGesture;
  readonly target: CanvasEndpoint;
  readonly point: CanvasPoint;
  readonly createText: CanvasEndpointGestureOptions['createText'];
}
export interface CanvasConnectionEditingOptions {
  finishText(): Promise<boolean>;
  createText(point: CanvasPoint, from: CanvasEndpoint): Promise<void>;
  clearCards(): void;
  report(failure: unknown): void;
  readDisplayVersion?(): number;
  /** 连线圆点压在选中描边中线上；描边随卡片材质变化，由宿主给出离几何边的内缩距离。 */
  readAnchorInset?(zoom: number): number;
}
export interface CanvasConnectionLabelEditingOptions {
  readonly session: CanvasDocumentSession;
  readonly state: CanvasConnectionState;
  readonly patch: (edge: CanvasEdge, patch: CanvasPatch) => Promise<void>;
  readonly report: (failure: unknown) => void;
}
export interface CanvasConnectionToolbarInput {
  readonly geometry: NonNullable<ReturnType<CanvasConnectionKernel['readEdgeGeometry']>>;
  readonly camera: CanvasCamera;
  readonly size: { readonly width: number; readonly height: number };
  readonly viewport: { readonly width: number; readonly height: number };
}
