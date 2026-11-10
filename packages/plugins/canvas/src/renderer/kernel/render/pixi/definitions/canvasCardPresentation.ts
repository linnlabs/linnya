import type { Container, Texture } from 'pixi.js';
import type { CanvasCamera, CanvasCard, CanvasCardId } from '../../../../../shared';
import type { CanvasAppearance } from '../../../definitions/canvasKernel';
import type { CanvasKernelText } from '../../../definitions/canvasKernelText';
import type { CanvasBitmapCache } from '../CanvasBitmapCache';
import type { CanvasIdentityAtlas } from '../CanvasIdentityAtlas';
import type { CanvasMapLabels } from '../CanvasMapLabels';
import type { CanvasMotionView } from '../CanvasSceneMotion';
import type { CanvasSpatialProjection } from '../../../geometry/CanvasSpatialProjection';
import type { CanvasCardView } from './canvasCardView';

/** 同步投影读取的实时事实；构造时绑定一次，不为每卡/每帧创建上下文快照。 */
export interface CanvasCardPresentationContext {
  readCamera(): CanvasCamera;
  readWidth(): number;
  readHeight(): number;
  readAppearance(): CanvasAppearance;
  readonly selected: ReadonlySet<CanvasCardId>;
  readEditingCard(): CanvasCardId | null;
  /** 改尺寸中或松手后新排版未到的卡：旧排版正文盖不满新纸面，但不能因此补画占位标题。 */
  showsOldLayout(id: CanvasCardId): boolean;
  readRenders(): number;
  readContextLost(): boolean;
  readDestroyed(): boolean;
}
export interface CanvasCardPresentationOptions {
  readonly text: Pick<CanvasKernelText, 'imageTitle' | 'blankTitle' | 'documentTitle'>;
  readonly backgrounds: {
    readonly paper: Texture;
    readonly card: Texture;
    readonly shadow: Texture;
  };
  readonly identityContext: CanvasRenderingContext2D;
  readonly context: CanvasCardPresentationContext;
  readonly layer: Container;
  readonly bitmaps: CanvasBitmapCache;
  readonly identities: CanvasIdentityAtlas;
  readonly mapLabels: CanvasMapLabels;
  readonly views: ReadonlyMap<CanvasCardId, CanvasCardView>;
  readonly retiringViews: ReadonlyMap<CanvasCardId, CanvasCardView>;
  readonly cards: ReadonlyMap<CanvasCardId, CanvasCard>;
  readonly spatial: CanvasSpatialProjection;
  readonly readOrdered: () => readonly CanvasCard[];
  readonly maskChanged: () => void;
  readonly hasMotion: (id: CanvasCardId) => boolean;
  readonly applyMotion: (view: CanvasMotionView) => void;
  readonly refreshTitleOrder: () => void;
  readonly updateLabels: () => void;
  readonly schedule: () => void;
}
