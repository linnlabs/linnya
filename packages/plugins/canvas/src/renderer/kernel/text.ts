// 纯文字排版规则的轻入口：不加载 Pixi，供 DOM 侧（如连线标签全文预览）与画布绘制共用同一判定。
export { CANVAS_LINE_LABEL_FONT, canvasLineLabelTruncated } from './geometry/canvasLineLabelFit';
