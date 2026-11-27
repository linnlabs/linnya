/** 浮层放在锚点的哪一侧。 */
export type AnchoredSide = 'top' | 'bottom' | 'left' | 'right';

/** 浮层沿锚点那条边怎样对齐：start 对齐左沿 / 上沿，end 对齐右沿 / 下沿，center 居中。 */
export type AnchoredAlign = 'start' | 'center' | 'end';

/**
 * 锚点：真实元素，或只提供视口矩形的虚拟锚点（右键菜单的点击位置、选区等）。
 * 虚拟锚点跟随滚动重算时，`contextElement` 告诉定位要监听哪棵滚动树。
 */
export type AnchoredAnchor =
  | Element
  | {
    getBoundingClientRect(): DOMRect;
    readonly contextElement?: Element;
  };

export interface AnchoredPositionOptions {
  /** 默认 `bottom`。放不下时翻到对侧，`flip: false` 时不翻。 */
  readonly side?: AnchoredSide;
  /** 默认 `start`。 */
  readonly align?: AnchoredAlign;
  /** 浮层与锚点之间的距离，默认 8（见 docs/design.md“定位按布局尺寸算，与触发点留 8px”）。 */
  readonly gap?: number;
  /**
   * 沿对齐方向的偏移，默认 0。负数让浮层越过锚点的对齐边往外伸（`start` 往左 / 上、`end` 往右 / 下），
   * 用于让面板内容的内边距与触发按钮对齐；`center` 不生效。
   */
  readonly alignOffset?: number;
  /** 浮层与视口边缘至少留出的距离，默认 8。 */
  readonly viewportMargin?: number;
  /** 默认 true。 */
  readonly flip?: boolean;
  /** 宽度跟锚点一样宽（下拉框面板）。 */
  readonly matchAnchorWidth?: boolean;
  /** 高度不超过所在一侧的可用空间，超出部分由浮层内容自己滚动。 */
  readonly fitViewportHeight?: boolean;
}

/**
 * 绑定到浮层根元素的内联样式；只含定位相关的几项，调用方再合并自己的层级等样式。
 * 用 type 而不是 interface：Vue 的 `:style` 类型带 `--*` 自定义属性的索引签名，interface 不能直接赋给它。
 */
export type AnchoredFloatingStyle = {
  readonly position: 'fixed';
  readonly top: string;
  readonly left: string;
  readonly width?: string;
  readonly maxHeight?: string;
};

/** 一次定位的结果；坐标是浮层 `position: fixed` 的 top / left。 */
export interface AnchoredPosition {
  readonly top: number;
  readonly left: number;
  /** 实际落在哪一侧（翻转后可能与请求的不同），动效方向按它取。 */
  readonly side: AnchoredSide;
  readonly align: AnchoredAlign;
  /** 仅 `matchAnchorWidth` 时给出。 */
  readonly width?: number;
  /** 仅 `fitViewportHeight` 时给出。 */
  readonly maxHeight?: number;
}
