import {
  createColorPickerOptions,
  type ColorPickerOptionDefinition,
} from '@linnya/renderer-ui';

type ElementPropertyColorKey =
  | 'black' | 'slate' | 'blue' | 'cyan' | 'green' | 'yellow' | 'orange' | 'red'
  | 'purple' | 'white';

const COLOR_DEFINITIONS: readonly ColorPickerOptionDefinition<ElementPropertyColorKey>[] = [
  { value: '#111827', labelKey: 'black', fallbackLabel: '#111827', cssVar: '--slides-property-black', fallbackHex: '#111827' },
  { value: '#64748B', labelKey: 'slate', fallbackLabel: '#64748B', cssVar: '--slides-property-slate', fallbackHex: '#64748B' },
  { value: '#2563EB', labelKey: 'blue', fallbackLabel: '#2563EB', cssVar: '--slides-property-blue', fallbackHex: '#2563EB' },
  { value: '#0891B2', labelKey: 'cyan', fallbackLabel: '#0891B2', cssVar: '--slides-property-cyan', fallbackHex: '#0891B2' },
  { value: '#16A34A', labelKey: 'green', fallbackLabel: '#16A34A', cssVar: '--slides-property-green', fallbackHex: '#16A34A' },
  { value: '#EAB308', labelKey: 'yellow', fallbackLabel: '#EAB308', cssVar: '--slides-property-yellow', fallbackHex: '#EAB308' },
  { value: '#EA580C', labelKey: 'orange', fallbackLabel: '#EA580C', cssVar: '--slides-property-orange', fallbackHex: '#EA580C' },
  { value: '#DC2626', labelKey: 'red', fallbackLabel: '#DC2626', cssVar: '--slides-property-red', fallbackHex: '#DC2626' },
  { value: '#9333EA', labelKey: 'purple', fallbackLabel: '#9333EA', cssVar: '--slides-property-purple', fallbackHex: '#9333EA' },
  { value: '#FFFFFF', labelKey: 'white', fallbackLabel: '#FFFFFF', cssVar: '--slides-property-white', fallbackHex: '#FFFFFF' },
];

export const ELEMENT_PROPERTY_COLOR_OPTIONS = createColorPickerOptions(COLOR_DEFINITIONS);
