import type { Container, NineSliceSprite, Sprite } from 'pixi.js';
import type { CanvasMotionView } from '../CanvasSceneMotion';

export interface CanvasCardView extends CanvasMotionView {
  readonly background: NineSliceSprite;
  readonly body: Container;
  readonly label: Sprite;
  visibleAfterRender: number;
  firstVisibleAfterRender: number;
  rasterContentKey: string | undefined;
}
