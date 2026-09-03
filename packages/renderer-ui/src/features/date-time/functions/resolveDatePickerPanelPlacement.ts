import type {
  DatePickerPanelPlacement,
  DatePickerPanelPlacementInput,
} from '../definitions/simpleDatePicker';

export function resolveDatePickerPanelPlacement(
  input: DatePickerPanelPlacementInput,
): DatePickerPanelPlacement {
  const spaceBelow = input.boundaryBottom - input.triggerBottom;
  const spaceAbove = input.triggerTop - input.boundaryTop;

  return spaceBelow < input.panelHeight + input.panelGap && spaceAbove > spaceBelow
    ? 'top'
    : 'bottom';
}
