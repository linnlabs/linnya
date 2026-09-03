export interface ScrollableStageLayoutInput {
  viewportWidth: number;
  viewportHeight: number;
  slideWidth: number;
  slideHeight: number;
  scale: number;
  gutter: number;
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

  return {
    contentWidth,
    contentHeight,
    slideLeft: (contentWidth - scaledSlideWidth) / 2,
    slideTop: (contentHeight - scaledSlideHeight) / 2,
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
