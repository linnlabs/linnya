const MIN_LATEST_THRESHOLD_PX = 16;

export interface ConversationVirtualizerGeometryInput {
  readonly scrollTop: number;
  readonly scrollClientTop: number;
  readonly scrollRectTop: number;
  readonly listRectTop: number;
  readonly footerHeight: number;
  readonly contentPaddingBottom: number;
}

export interface ConversationVirtualizerGeometry {
  readonly scrollMargin: number;
  readonly scrollEndThreshold: number;
}

export function resolveConversationVirtualizerGeometry(
  input: ConversationVirtualizerGeometryInput,
): ConversationVirtualizerGeometry {
  return {
    scrollMargin: Math.max(
      0,
      input.listRectTop
        - input.scrollRectTop
        - input.scrollClientTop
        + input.scrollTop,
    ),
    scrollEndThreshold: Math.max(
      MIN_LATEST_THRESHOLD_PX,
      input.footerHeight
        + input.contentPaddingBottom
        + 1,
    ),
  };
}
