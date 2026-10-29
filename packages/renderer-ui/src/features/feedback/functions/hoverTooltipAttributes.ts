import {
  HOVER_TOOLTIP_OFFSET_ATTRIBUTE,
  HOVER_TOOLTIP_PLACEMENT_ATTRIBUTE,
  HOVER_TOOLTIP_TEXT_ATTRIBUTE,
  type HoverTooltipPlacement,
} from '../definitions/hoverTooltip';

export interface HoverTooltipAttributeOptions {
  readonly placement?: HoverTooltipPlacement;
  readonly offset?: number;
}

/** 让元素获得共享提示服务的属性；没有文字时返回空对象，元素不会有提示。 */
export function hoverTooltipAttributes(
  text: string | undefined,
  options: HoverTooltipAttributeOptions = {},
): Record<string, string | number> {
  if (text === undefined || text === '') return {};
  return {
    [HOVER_TOOLTIP_TEXT_ATTRIBUTE]: text,
    ...(options.placement === undefined ? {} : { [HOVER_TOOLTIP_PLACEMENT_ATTRIBUTE]: options.placement }),
    ...(options.offset === undefined ? {} : { [HOVER_TOOLTIP_OFFSET_ATTRIBUTE]: options.offset }),
  };
}
