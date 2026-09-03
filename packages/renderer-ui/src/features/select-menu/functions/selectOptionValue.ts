import type {
  CustomSelectInlineNumberInput,
  CustomSelectOption,
  CustomSelectOptionValue,
  CustomSelectValue,
} from '../definitions/selectMenu';

export function findSelectedOption<Value extends CustomSelectOptionValue>(
  options: readonly CustomSelectOption<Value>[],
  modelValue: Value | null,
): CustomSelectOption<Value> | undefined {
  for (const option of options) {
    if (!option.isGroup && !option.isSeparator && option.value === modelValue) {
      return option;
    }

    const selectedChild = option.children
      ? findSelectedOption(option.children, modelValue)
      : undefined;
    if (selectedChild) return selectedChild;
  }

  return undefined;
}

export function normalizeInlineNumberValue(input: CustomSelectInlineNumberInput): number {
  const raw = Number(input.value);
  const fallbackValue = Number(input.min);
  const min = Number(input.min);
  const max = Number(input.max);

  if (!Number.isFinite(raw)) return fallbackValue;

  const rounded = Math.floor(raw);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

export function adjustInlineNumberValue(
  input: CustomSelectInlineNumberInput,
  delta: number,
): number {
  const currentValue = Number(input.value);
  const fallbackValue = Number(input.min);
  const baseValue = Number.isFinite(currentValue) ? currentValue : fallbackValue;
  const min = Number(input.min);
  const max = Number(input.max);
  return Math.min(max, Math.max(min, baseValue + delta));
}
