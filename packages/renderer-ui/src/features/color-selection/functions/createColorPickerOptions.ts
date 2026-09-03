import type {
  ColorPickerLabelResolver,
  ColorPickerOption,
  ColorPickerOptionDefinition,
} from '../definitions/colorPicker';

export function createColorPickerOptions<LabelKey extends string>(
  definitions: readonly ColorPickerOptionDefinition<LabelKey>[],
  resolveLabel?: ColorPickerLabelResolver<LabelKey>,
): readonly ColorPickerOption<LabelKey>[] {
  return definitions.map(definition => ({
    value: definition.value,
    labelKey: definition.labelKey,
    label: resolveLabel?.(definition.labelKey) ?? definition.fallbackLabel,
    cssVar: definition.cssVar,
    fallbackHex: definition.fallbackHex,
  }));
}
