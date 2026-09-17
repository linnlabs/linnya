import type { CustomColorHsv, CustomColorRgb, CustomColorRgbDraft } from '../definitions/customColor';

export function normalizeCustomColor(value: string): string | null {
  const hex = value.trim().replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
}

export function colorToHsv(hex: string): CustomColorHsv {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const sector = delta === 0 ? 0
    : max === r ? (g - b) / delta
      : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return {
    hue: (sector * 60 + 360) % 360,
    saturation: max === 0 ? 0 : delta / max,
    brightness: max,
  };
}

export function colorToRgb(hex: string): CustomColorRgb {
  return { red: parseInt(hex.slice(1, 3), 16), green: parseInt(hex.slice(3, 5), 16), blue: parseInt(hex.slice(5, 7), 16) };
}

export function isValidRgbChannel(value: string | number): boolean {
  return String(value).trim() !== '' && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 255;
}

/** 输入中的空值、小数和越界值必须留给用户修正，不能钳制后意外提交另一个颜色。 */
export function rgbDraftToColor(value: CustomColorRgbDraft): string | null {
  const channels = [value.red, value.green, value.blue];
  if (!channels.every(isValidRgbChannel)) return null;
  return `#${channels.map(channel => Number(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

export function hsvToColor(value: CustomColorHsv): string {
  const channel = (n: number): string => {
    const k = (n + value.hue / 60) % 6;
    const c = value.brightness * (1 - value.saturation * Math.max(0, Math.min(k, 4 - k, 1)));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`.toUpperCase();
}

export function colorPlaneValue(
  x: number, y: number, width: number, height: number,
): Pick<CustomColorHsv, 'saturation' | 'brightness'> {
  return {
    saturation: Math.max(0, Math.min(1, x / width)),
    brightness: 1 - Math.max(0, Math.min(1, y / height)),
  };
}
