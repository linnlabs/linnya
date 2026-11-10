/**
 * 菜单锚点，视口坐标。按钮菜单取按钮矩形；右键菜单取指针位置（宽高为 0）。
 * align 决定菜单与锚点哪一侧对齐：start 左对齐，end 右对齐。
 */
export interface CanvasMenuAnchor {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly align: 'start' | 'end';
}
