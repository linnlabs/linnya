import type { Container, Texture } from 'pixi.js';
import type { CanvasCamera, CanvasCard, CanvasCardId } from '../../../../../shared';
import type { CanvasAppearance } from '../../../definitions/canvasKernel';
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
  readRenders(): number;
  readContextLost(): boolean;
  readDestroyed(): boolean;
}
export interface CanvasCardPresentationOptions {
  readonly backgrounds: { readonly paper: Texture; readonly card: Texture };
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
