export interface ImagePreviewModalClassNames {
  readonly overlay?: string;
  readonly image?: string;
}

export interface ImagePreviewModalProps {
  readonly isVisible: boolean;
  readonly src?: string | null;
  readonly alt: string;
  /**
   * 触发预览的缩略图，或包含缩略图的按钮。传入后，大图从它“展开”出来、关闭时缩回它；
   * 不传、元素已不在屏幕上、浏览器不支持或系统开启“减少动态效果”时退回淡入淡出。
   */
  readonly sourceElement?: HTMLElement | null;
  readonly classNames?: ImagePreviewModalClassNames;
}
