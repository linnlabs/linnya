import type { CanvasAppearance } from '../definitions/canvasKernel';

export type CanvasCardMaterial = CanvasAppearance['material'];

/**
 * 卡片外框的唯一真源：纸面贴图、投影、选中描边与 DOM 叠层（编辑器、文档详情）共用，编辑态与选中态在各缩放下一致。
 * 卡片几何矩形四周留出 PAPER_INSET 给纸面阴影，看得见的纸面内缩这么多、圆角为 CORNER_RADIUS。长度为世界坐标。
 */
export const CANVAS_CARD_PAPER_INSET = 3;
export const CANVAS_CARD_CORNER_RADIUS = {
  paper: 2,
  card: 6,
} as const satisfies Readonly<Record<CanvasCardMaterial, number>>;

/**
 * 选中描边，向外画在以 inset 内缩、radius 为圆角的圆角矩形上；inset、radius 为世界坐标，width 为屏幕 CSS px。
 * 纸：离开纸边、压在几何矩形边上的一道细线，与纸面同心。
 * 卡：主题色细线贴住卡边。只有这一道线，不加光晕或投影：选中是状态，不是把卡抬起来。
 */
export interface CanvasSelectionOutline {
  readonly inset: number;
  readonly radius: number;
  readonly width: number;
}
export const CANVAS_SELECTION_OUTLINE = {
  paper: {
    inset: 0,
    radius: CANVAS_CARD_CORNER_RADIUS.paper + CANVAS_CARD_PAPER_INSET,
    width: 1.5,
  },
  card: {
    inset: CANVAS_CARD_PAPER_INSET,
    radius: CANVAS_CARD_CORNER_RADIUS.card,
    width: 1,
  },
} as const satisfies Readonly<Record<CanvasCardMaterial, CanvasSelectionOutline>>;

/**
 * 选中描边中线离卡片几何边的内缩距离（世界坐标，向外为负）。连线圆点等压在边上的控件按它摆放，
 * 任何缩放下都落在描边正中；卡片材质下也就是看得见的卡边。
 */
export function canvasSelectionOutlineCenter(material: CanvasCardMaterial, zoom: number): number {
  const outline = CANVAS_SELECTION_OUTLINE[material];
  return outline.inset - outline.width / 2 / zoom;
}
