/** 内核自己会显示的少量文字；渲染 worker 不知道界面语言，沿用这里的默认中文。 */
export interface CanvasKernelText {
  surfaceLabel(): string;
  imageTitle(): string;
  blankTitle(): string;
  documentTitle(): string;
  restoring(): string;
  titlesLimited(): string;
  software(): string;
}
export const DEFAULT_CANVAS_KERNEL_TEXT: CanvasKernelText = {
  surfaceLabel: () => '自由画布，按空格拖动平移，使用工具栏编辑所选卡片',
  imageTitle: () => '图片',
  blankTitle: () => '空白卡片',
  documentTitle: () => '文档',
  restoring: () => '图形渲染正在恢复，内容已保留',
  titlesLimited: () =>
    '当前视图的卡片标题暂时无法全部显示，请放大或移动画布后重试；文档仍可编辑和保存。',
  software: () => '当前使用软件绘图，性能受限',
};
