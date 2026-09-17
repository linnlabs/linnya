export interface CustomColorHsv {
  readonly hue: number;
  readonly saturation: number;
  readonly brightness: number;
}

export type CustomColorMode = 'hsv' | 'rgb';
export type CustomColorRgbChannel = 'red' | 'green' | 'blue';
export type CustomColorRgb = Readonly<Record<CustomColorRgbChannel, number>>;
export type CustomColorRgbDraft = Readonly<Record<CustomColorRgbChannel, string | number>>;
