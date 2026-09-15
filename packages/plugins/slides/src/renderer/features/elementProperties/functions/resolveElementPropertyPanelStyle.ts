export function resolveElementPropertyPanelStyle(input: {
  readonly slideLeft: number;
  readonly slideTop: number;
  readonly scaledSlideWidth: number;
}): Readonly<Record<string, string>> {
  return {
    left: `${input.slideLeft + Math.max(8, input.scaledSlideWidth - 232)}px`,
    top: `${input.slideTop + 8}px`,
  };
}
