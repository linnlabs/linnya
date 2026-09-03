import type { EditorMessageKey, EditorMessageResolver } from '../../../definitions/editorMessages';
import type { CustomSelectOption } from '@linnya/renderer-ui';

export type FloatingToolbarSelectOption = CustomSelectOption;

export interface FloatingToolbarColorOption {
  readonly value: string;
  readonly label: string;
  readonly cssVar: string;
}

export const FLOATING_TOOLBAR_HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

type FloatingToolbarHeadingLevel = (typeof FLOATING_TOOLBAR_HEADING_LEVELS)[number];

interface ColorDefinition {
  readonly value: string;
  readonly labelKey: EditorMessageKey;
  readonly cssVar: string;
}

const NBSP = '\u00A0';

const TEXT_COLOR_DEFINITIONS: readonly ColorDefinition[] = [
  { value: 'red_text', labelKey: 'editor.color.red', cssVar: '--block-text-red' },
  { value: 'crimson_text', labelKey: 'editor.color.crimson', cssVar: '--block-text-crimson' },
  { value: 'pink_text', labelKey: 'editor.color.pink', cssVar: '--block-text-pink' },
  { value: 'purple_text', labelKey: 'editor.color.purple', cssVar: '--block-text-purple' },
  { value: 'indigo_text', labelKey: 'editor.color.indigo', cssVar: '--block-text-indigo' },
  { value: 'blue_text', labelKey: 'editor.color.blue', cssVar: '--block-text-blue' },
  { value: 'teal_text', labelKey: 'editor.color.teal', cssVar: '--block-text-teal' },
  { value: 'mint_text', labelKey: 'editor.color.mint', cssVar: '--block-text-mint' },
  { value: 'green_text', labelKey: 'editor.color.green', cssVar: '--block-text-green' },
  { value: 'lime_text', labelKey: 'editor.color.lime', cssVar: '--block-text-lime' },
  { value: 'yellow_text', labelKey: 'editor.color.yellow', cssVar: '--block-text-yellow' },
  { value: 'orange_text', labelKey: 'editor.color.orange', cssVar: '--block-text-orange' },
  { value: 'brown_text', labelKey: 'editor.color.brown', cssVar: '--block-text-brown' },
  { value: 'slate_text', labelKey: 'editor.color.slate', cssVar: '--block-text-slate' },
  { value: 'gray_text', labelKey: 'editor.color.gray', cssVar: '--block-text-gray' },
] as const;

const BRIGHT_HIGHLIGHT_DEFINITIONS: readonly ColorDefinition[] = [
  { value: 'bright_yellow', labelKey: 'editor.color.brightYellow', cssVar: '--highlight-bright-yellow' },
  { value: 'bright_pink', labelKey: 'editor.color.brightPink', cssVar: '--highlight-bright-pink' },
  { value: 'bright_green', labelKey: 'editor.color.brightGreen', cssVar: '--highlight-bright-green' },
  { value: 'bright_orange', labelKey: 'editor.color.brightOrange', cssVar: '--highlight-bright-orange' },
  { value: 'bright_blue', labelKey: 'editor.color.brightBlue', cssVar: '--highlight-bright-blue' },
] as const;

const HEADING_LEVEL_MESSAGE_KEYS: Readonly<Record<FloatingToolbarHeadingLevel, EditorMessageKey>> = {
  1: 'editor.floatingToolbar.heading.level1',
  2: 'editor.floatingToolbar.heading.level2',
  3: 'editor.floatingToolbar.heading.level3',
  4: 'editor.floatingToolbar.heading.level4',
  5: 'editor.floatingToolbar.heading.level5',
  6: 'editor.floatingToolbar.heading.level6',
};

export function readFloatingToolbarHeadingOptions(
  editorMessage: EditorMessageResolver,
): readonly FloatingToolbarSelectOption[] {
  return [
    ...FLOATING_TOOLBAR_HEADING_LEVELS.map((level) => ({
      value: level,
      text: `H${level}${NBSP}${NBSP}${NBSP}${editorMessage(HEADING_LEVEL_MESSAGE_KEYS[level])}`,
    })),
    { isSeparator: true, value: null, text: '' },
    { value: null, text: editorMessage('editor.floatingToolbar.paragraph') },
  ];
}

export function readFloatingToolbarColorPanelOptions(
  editorMessage: EditorMessageResolver,
): readonly FloatingToolbarSelectOption[] {
  return [
    { value: 'panel', text: editorMessage('editor.floatingToolbar.colorPanel') },
  ];
}

export function readFloatingToolbarHighlightPanelOptions(
  editorMessage: EditorMessageResolver,
): readonly FloatingToolbarSelectOption[] {
  return [
    { value: 'panel', text: editorMessage('editor.floatingToolbar.highlightPanel') },
  ];
}

export function readFloatingToolbarTextColors(
  editorMessage: EditorMessageResolver,
): readonly FloatingToolbarColorOption[] {
  return TEXT_COLOR_DEFINITIONS.map((color) => ({
    value: color.value,
    label: editorMessage(color.labelKey),
    cssVar: color.cssVar,
  }));
}

export function readFloatingToolbarHighlightColors(
  editorMessage: EditorMessageResolver,
): readonly FloatingToolbarColorOption[] {
  return [...TEXT_COLOR_DEFINITIONS, ...BRIGHT_HIGHLIGHT_DEFINITIONS].map((color) => ({
    value: color.value,
    label: editorMessage(color.labelKey),
    cssVar: color.cssVar,
  }));
}
