export type CustomSliderVariant = 'default' | 'compact';

/** 有界连续数值输入。业务单位、保存时机与显示文案由调用方拥有。 */
export interface CustomSliderProps {
  readonly modelValue: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly disabled?: boolean;
  readonly variant?: CustomSliderVariant;
}
