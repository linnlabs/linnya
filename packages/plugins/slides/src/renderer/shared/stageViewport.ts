export interface ScrollableStageLayoutInput {
  viewportWidth: number;
  viewportHeight: number;
  slideWidth: number;
  slideHeight: number;
  scale: number;
  gutter: number;
  /**
   * 未溢出时的上下留白。幻灯片在留白之间的区域居中；放不下时贴近该位置但不越出视口。
   * 省略时在整个视口居中。
   */
  verticalInsets?: { readonly top: number; readonly bottom: number };
}

export interface ScrollableStageLayout {
  contentWidth: number;
  contentHeight: number;
  slideLeft: number;
  slideTop: number;
  slideWidth: number;
  slideHeight: number;
  scaledSlideWidth: number;
  scaledSlideHeight: number;
}

export interface ScrollableStagePosition {
  scrollLeft: number;
  scrollTop: number;
}

export interface InitialScrollableStageScrollInput {
  viewportWidth: number;
  viewportHeight: number;
  layout: ScrollableStageLayout;
}

export interface AnchoredScrollPositionInput {
  anchorViewportX: number;
  anchorViewportY: number;
  viewportWidth: number;
  viewportHeight: number;
  prevScrollLeft: number;
  prevScrollTop: number;
  prevLayout: ScrollableStageLayout;
  nextLayout: ScrollableStageLayout;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getMaxScroll(content: number, viewport: number): number {
  return Math.max(content - viewport, 0);
}

export function computeScrollableStageLayout(input: ScrollableStageLayoutInput): ScrollableStageLayout {
  const scaledSlideWidth = input.slideWidth * input.scale;
  const scaledSlideHeight = input.slideHeight * input.scale;
  const widthOverflow = scaledSlideWidth > input.viewportWidth;
  const heightOverflow = scaledSlideHeight > input.viewportHeight;
  const contentWidth = widthOverflow
    ? scaledSlideWidth + input.gutter * 2
    : input.viewportWidth;
  const contentHeight = heightOverflow
    ? scaledSlideHeight + input.gutter * 2
    : input.viewportHeight;

  const insetShift = input.verticalInsets
    ? (input.verticalInsets.top - input.verticalInsets.bottom) / 2
    : 0;
  const slideTop = heightOverflow
    ? (contentHeight - scaledSlideHeight) / 2
    : clamp((contentHeight - scaledSlideHeight) / 2 + insetShift, 0, contentHeight - scaledSlideHeight);

  return {
    contentWidth,
    contentHeight,
    slideLeft: (contentWidth - scaledSlideWidth) / 2,
    slideTop,
    slideWidth: input.slideWidth,
    slideHeight: input.slideHeight,
    scaledSlideWidth,
    scaledSlideHeight,
  };
}

export function computeInitialScrollableStageScroll(
  input: InitialScrollableStageScrollInput,
): ScrollableStagePosition {
  return {
    scrollLeft: getMaxScroll(input.layout.contentWidth, input.viewportWidth) / 2,
    scrollTop: getMaxScroll(input.layout.contentHeight, input.viewportHeight) / 2,
  };
}

export function computeAnchoredScrollPosition(
  input: AnchoredScrollPositionInput,
): ScrollableStagePosition {
  const prevContentX = input.prevScrollLeft + input.anchorViewportX;
  const prevContentY = input.prevScrollTop + input.anchorViewportY;

  const widthRatio = input.prevLayout.scaledSlideWidth > 0
    ? (prevContentX - input.prevLayout.slideLeft) / input.prevLayout.scaledSlideWidth
    : 0;
  const heightRatio = input.prevLayout.scaledSlideHeight > 0
    ? (prevContentY - input.prevLayout.slideTop) / input.prevLayout.scaledSlideHeight
    : 0;

  const nextContentX = input.nextLayout.slideLeft + widthRatio * input.nextLayout.scaledSlideWidth;
  const nextContentY = input.nextLayout.slideTop + heightRatio * input.nextLayout.scaledSlideHeight;

  return {
    scrollLeft: clamp(
      nextContentX - input.anchorViewportX,
      0,
      getMaxScroll(input.nextLayout.contentWidth, input.viewportWidth),
    ),
    scrollTop: clamp(
      nextContentY - input.anchorViewportY,
      0,
      getMaxScroll(input.nextLayout.contentHeight, input.viewportHeight),
    ),
  };
}
