// 卡片纸面规则的轻入口：不加载 Pixi，供 DOM 叠层与画布绘制共用同一纸面内缩与圆角。
export {
  CANVAS_CARD_CORNER_RADIUS,
  CANVAS_CARD_PAPER_INSET,
  canvasSelectionOutlineCenter,
} from './geometry/canvasCardFrame';
