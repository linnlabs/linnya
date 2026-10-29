/**
 * 画布编辑框线标准。所有框线都是 1 个屏幕像素，不随缩放变粗；用途靠线型与透明度区分：
 * - 实线：已经选中的对象，以及多选的整体外框；
 * - 淡实线（45%）：鼠标悬停的对象、多选里的各个成员；
 * - 虚线：还没提交的几何——框选范围、插入占位、拖动中的文字宽度；
 * - 品红实线：吸附参考线。
 * 坐标对齐到设备像素中心，四条边落在同样的像素格上，不会一边清晰一边发虚。
 */
export const SELECTION_OUTLINE_SOFT_OPACITY = 0.45;
/** 虚线节奏，单位为屏幕 CSS px。 */
export const SELECTION_OUTLINE_DASH = [4, 3] as const;

export interface SelectionOutlineGrid {
  /** 1 个屏幕像素对应的内容坐标宽度。 */
  readonly strokeWidth: number;
  /** 把内容坐标对齐到线宽对应的设备像素中心。 */
  readonly snap: (value: number) => number;
  readonly dash: readonly number[];
}

/**
 * @param scale 内容坐标到 CSS px 的缩放
 * @param devicePixelRatio 画布每个 CSS px 的设备像素数
 */
export function createSelectionOutlineGrid(scale: number, devicePixelRatio: number): SelectionOutlineGrid {
  const safeScale = Math.max(scale, 0.001);
  const ratio = safeScale * Math.max(devicePixelRatio, 1);
  // 1 个 CSS px 在高分屏上占整数个设备像素，线心落在这条像素带的中点。
  const width = Math.max(1, Math.round(devicePixelRatio));
  return {
    strokeWidth: width / ratio,
    snap: value => (Math.round(value * ratio - width / 2) + width / 2) / ratio,
    dash: SELECTION_OUTLINE_DASH.map(length => length / safeScale),
  };
}
