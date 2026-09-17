import type { CustomSelectOption } from '@linnya/renderer-ui';
import { SLIDES_MANUAL_FONT_SIZE_PT } from '@plugin/slides/shared/authoringEditing';

/** 常用字号只是快捷入口；范围内的其他数值（含小数）仍可直接输入。 */
export const ELEMENT_FONT_SIZE_OPTIONS: readonly CustomSelectOption<number>[] = [
  SLIDES_MANUAL_FONT_SIZE_PT.min, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32,
  36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96, 120, 144, 200, 288,
  SLIDES_MANUAL_FONT_SIZE_PT.max,
].map(value => ({ value, text: String(value) }));
