import type {
  ContextUsagePanelPosition,
  ContextUsagePanelPositionInput,
} from '../definitions/contextWindowUsage';

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function resolveContextUsagePanelPosition(
  input: ContextUsagePanelPositionInput,
): ContextUsagePanelPosition {
  const maximumLeft = Math.max(input.padding, input.viewport.width - input.panel.width - input.padding);
  const left = clamp(input.trigger.right - input.panel.width, input.padding, maximumLeft);
  const topAbove = input.trigger.top - input.gap - input.panel.height;
  const topBelow = input.trigger.bottom + input.gap;
  const maximumTop = Math.max(input.padding, input.viewport.height - input.panel.height - input.padding);
  const preferredTop = topAbove >= input.padding ? topAbove : topBelow;

  return {
    top: clamp(preferredTop, input.padding, maximumTop),
    left,
  };
}
