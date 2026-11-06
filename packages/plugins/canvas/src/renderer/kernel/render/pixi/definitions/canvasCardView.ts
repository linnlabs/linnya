import type { Container, NineSliceSprite, Sprite } from 'pixi.js';
import type { CanvasMotionView } from '../CanvasSceneMotion';

export interface CanvasCardView extends CanvasMotionView {
  /** 卡片材质的投影，纸材质隐藏（纸的贴地阴影烘在纸面贴图里）。 */
  readonly shadow: NineSliceSprite;
  readonly background: NineSliceSprite;
  readonly body: Container;
  readonly label: Sprite;
  visibleAfterRender: number;
  firstVisibleAfterRender: number;
  rasterContentKey: string | undefined;
}
