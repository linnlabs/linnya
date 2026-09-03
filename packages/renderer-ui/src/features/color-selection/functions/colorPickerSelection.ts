import type {
  ColorPickerCompareMode,
  ColorPickerCssVariableReader,
  ColorPickerOption,
} from '../definitions/colorPicker';

export function resolveColorPickerOptionHex(
  option: ColorPickerOption,
  readCssVariable: ColorPickerCssVariableReader,
): string {
  const cssValue = readCssVariable(option.cssVar).trim();
  return cssValue || option.fallbackHex;
}

export function isColorPickerOptionCurrent(
  currentValue: string | null | undefined,
  option: ColorPickerOption,
  compareMode: ColorPickerCompareMode,
  readCssVariable: ColorPickerCssVariableReader,
): boolean {
  const normalizedCurrent = normalizeColorPickerValue(currentValue);
  if (!normalizedCurrent) return false;

  const candidate = compareMode === 'by-value'
    ? option.value
    : resolveColorPickerOptionHex(option, readCssVariable);
  return normalizedCurrent === normalizeColorPickerValue(candidate);
}

function normalizeColorPickerValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}
