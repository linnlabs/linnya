export type ColorPickerCompareMode = 'by-value' | 'by-resolved-hex';

export interface ColorPickerOption<LabelKey extends string = string> {
  readonly value: string;
  readonly labelKey: LabelKey;
  readonly label: string;
  readonly cssVar: string;
  readonly fallbackHex: string;
}

export interface ColorPickerOptionDefinition<LabelKey extends string = string> {
  readonly value: string;
  readonly labelKey: LabelKey;
  readonly fallbackLabel: string;
  readonly cssVar: string;
  readonly fallbackHex: string;
}

export type ColorPickerLabelResolver<LabelKey extends string = string> = (
  key: LabelKey,
) => string;

export type ColorPickerCssVariableReader = (cssVariable: string) => string;

export interface ColorPickerPanelProps<LabelKey extends string = string> {
  readonly backgroundColors?: readonly ColorPickerOption<LabelKey>[];
  readonly textColors?: readonly ColorPickerOption<LabelKey>[];
  readonly currentBackgroundValue?: string | null;
  readonly currentTextValue?: string | null;
  readonly showBackground?: boolean;
  readonly showText?: boolean;
  readonly showClearButton?: boolean;
  readonly clearButtonText?: string;
  readonly backgroundTitle?: string;
  readonly textTitle?: string;
  readonly noPadding?: boolean;
  readonly compareMode?: ColorPickerCompareMode;
  readonly labelResolver?: ColorPickerLabelResolver<LabelKey>;
}
