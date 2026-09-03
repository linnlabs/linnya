export interface TimelineLayoutReserveInput {
  columnMaxWidth: number;
  contentBoxWidth: number;
  isTimelineCollapsed: boolean;
  timelineReserve: number;
}

export interface TimelineAwareContentWidthInput extends TimelineLayoutReserveInput {
  leftSpace?: number;
}

export interface TimelineContentWidthForReserveInput {
  columnMaxWidth: number;
  contentBoxWidth: number;
  reserve: number;
  leftSpace?: number;
}

export interface TimelineReserveForContentWidthInput {
  columnMaxWidth: number;
  contentBoxWidth: number;
  contentWidth: number;
  leftSpace?: number;
}

export interface TimelineLayoutAnimationReserveInput extends TimelineLayoutReserveInput {
  currentReserve: number;
  leftSpace?: number;
}

export interface TimelineLayoutAnimationReserve {
  finalReserve: number;
  startContentWidth: number;
  targetContentWidth: number;
  startReserve: number;
  targetReserve: number;
}

export function calculateTimelineContentLeftSpace(input: {
  columnMaxWidth: number;
  contentBoxWidth: number;
  leftSpace?: number;
}): number {
  if (typeof input.leftSpace === 'number') {
    return Math.max(input.leftSpace, 0);
  }

  if (input.columnMaxWidth <= 0) {
    return 0;
  }

  return Math.max((input.contentBoxWidth - input.columnMaxWidth) / 2, 0);
}

export function calculateTimelineLayoutReserve(input: TimelineLayoutReserveInput): number {
  if (input.isTimelineCollapsed || input.columnMaxWidth <= 0 || input.timelineReserve <= 0) {
    return 0;
  }

  const hasTimelineSideSpace = input.contentBoxWidth >= input.columnMaxWidth + input.timelineReserve * 2;
  return hasTimelineSideSpace ? 0 : input.timelineReserve;
}

export function calculateTimelineAwareContentWidth(input: TimelineAwareContentWidthInput): number {
  if (input.columnMaxWidth <= 0) {
    return input.contentBoxWidth;
  }

  const leftSpace = calculateTimelineContentLeftSpace(input);
  const timelineReserve = calculateTimelineLayoutReserve(input);

  return Math.min(
    input.columnMaxWidth,
    Math.max(input.contentBoxWidth - leftSpace - timelineReserve, 0),
  );
}

export function calculateTimelineContentWidthForReserve(input: TimelineContentWidthForReserveInput): number {
  const leftSpace = calculateTimelineContentLeftSpace(input);
  const contentWidth = Math.max(input.contentBoxWidth - leftSpace - input.reserve, 0);

  if (input.columnMaxWidth <= 0) {
    return contentWidth;
  }

  return Math.min(input.columnMaxWidth, contentWidth);
}

export function calculateTimelineReserveForContentWidth(input: TimelineReserveForContentWidthInput): number {
  const leftSpace = calculateTimelineContentLeftSpace(input);
  return Math.max(input.contentBoxWidth - leftSpace - input.contentWidth, 0);
}

export function calculateTimelineLayoutAnimationReserve(
  input: TimelineLayoutAnimationReserveInput,
): TimelineLayoutAnimationReserve {
  const finalReserve = calculateTimelineLayoutReserve(input);
  const startContentWidth = calculateTimelineContentWidthForReserve({
    columnMaxWidth: input.columnMaxWidth,
    contentBoxWidth: input.contentBoxWidth,
    leftSpace: input.leftSpace,
    reserve: input.currentReserve,
  });
  const targetContentWidth = calculateTimelineAwareContentWidth(input);

  return {
    finalReserve,
    startContentWidth,
    targetContentWidth,
    startReserve: calculateTimelineReserveForContentWidth({
      columnMaxWidth: input.columnMaxWidth,
      contentBoxWidth: input.contentBoxWidth,
      contentWidth: startContentWidth,
      leftSpace: input.leftSpace,
    }),
    targetReserve: calculateTimelineReserveForContentWidth({
      columnMaxWidth: input.columnMaxWidth,
      contentBoxWidth: input.contentBoxWidth,
      contentWidth: targetContentWidth,
      leftSpace: input.leftSpace,
    }),
  };
}
