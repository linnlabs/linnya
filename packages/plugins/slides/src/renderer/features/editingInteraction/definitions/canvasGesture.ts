import type { ManualEditableTarget } from '../../manualEditing';
import type { RenderNodeSelectionPoint, RenderNodeSelectionRect } from '../../renderNodeSelection';

interface PointerGestureBase {
  readonly pointerId: number;
  readonly captureElement: HTMLElement | null;
  readonly anchor: RenderNodeSelectionPoint;
  readonly screenX: number;
  readonly screenY: number;
  dragged: boolean;
}
export type CanvasPointerGesture =
  | (PointerGestureBase & { readonly kind: 'marquee'; readonly additive: boolean; readonly baseline: readonly ManualEditableTarget[] })
  | (PointerGestureBase & { readonly kind: 'translate'; readonly targets: readonly ManualEditableTarget[];
      readonly path: readonly ManualEditableTarget[]; readonly clickTarget: ManualEditableTarget;
      /** 未拖动松手时的选择结果：单选点击目标、Shift 切换成员，或保留按下时已追加的选区。 */
      readonly clickMode: 'select' | 'toggle' | 'keep';
      readonly bounds: RenderNodeSelectionRect; readonly peers: readonly RenderNodeSelectionRect[];
      readonly canTranslate: boolean });
/** position 是对齐线所在坐标；from/to 是线沿另一轴的范围（页面对齐贯穿整页）。单位 inches。 */
export interface CanvasSnapGuide { readonly axis: 'x' | 'y'; readonly position: number; readonly from: number; readonly to: number }
