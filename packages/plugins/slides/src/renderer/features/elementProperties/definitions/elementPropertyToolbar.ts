export interface ElementPropertyRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ElementPropertySize {
  readonly width: number;
  readonly height: number;
}

/** 坐标均为当前 Slides viewport 内的 CSS 像素，不与整窗坐标混用。 */
export interface ElementPropertyAnchor {
  readonly selection: ElementPropertyRect;
  readonly viewport: ElementPropertySize;
  /** viewport 顶部被常驻工具占用的高度；浮条不放进这片区域。 */
  readonly reservedTop?: number;
}

export type ElementPropertyPopover = 'fontSize' | 'alignment' | 'arrange' | 'more' | 'text' | 'fill' | 'size';
export type ElementPropertyNumberField = 'fontSize' | 'width' | 'height';
