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
}

export type ElementPropertyPopover = 'fontSize' | 'text' | 'fill' | 'size';
export type ElementPropertyNumberField = 'fontSize' | 'width' | 'height';
