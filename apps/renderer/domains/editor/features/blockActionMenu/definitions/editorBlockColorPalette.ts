/**
 * 编辑器块操作菜单的文本色与背景色板。
 * 说明：
 * - value: 业务值（如 red_text / red_bg）
 * - labelKey: 色名文案 key，由共享组件或调用方按当前语言解析
 * - cssVar: 主题变量名（如 --block-text-red）
 * - fallbackHex: 当 CSS 变量未定义时的回退色（优先保证可用）
 */
import {
  createColorPickerOptions,
  type ColorPickerOption,
  type ColorPickerOptionDefinition,
} from '@linnya/renderer-ui';
import type {
  SharedColorMessageKey,
  SharedComponentMessageResolver,
} from '@linnya/renderer-ui/localization';

export type EditorBlockColorOption = ColorPickerOption<SharedColorMessageKey>;

/**
 * 文本颜色预设（顺序与 BlockColorPicker 保持一致）。
 */
const EDITOR_BLOCK_TEXT_COLOR_DEFINITIONS: readonly ColorPickerOptionDefinition<SharedColorMessageKey>[] = [
    { value: 'red_text', labelKey: 'shared.color.red', fallbackLabel: 'Red', cssVar: '--block-text-red', fallbackHex: '#d44c47' },
    { value: 'crimson_text', labelKey: 'shared.color.crimson', fallbackLabel: 'Crimson', cssVar: '--block-text-crimson', fallbackHex: '#e11d48' },
    { value: 'pink_text', labelKey: 'shared.color.pink', fallbackLabel: 'Pink', cssVar: '--block-text-pink', fallbackHex: '#c14c8a' },
    { value: 'purple_text', labelKey: 'shared.color.purple', fallbackLabel: 'Purple', cssVar: '--block-text-purple', fallbackHex: '#9065b0' },
    { value: 'indigo_text', labelKey: 'shared.color.indigo', fallbackLabel: 'Indigo', cssVar: '--block-text-indigo', fallbackHex: '#5c6ac4' },
    { value: 'blue_text', labelKey: 'shared.color.blue', fallbackLabel: 'Blue', cssVar: '--block-text-blue', fallbackHex: '#337ea9' },
    { value: 'teal_text', labelKey: 'shared.color.teal', fallbackLabel: 'Teal', cssVar: '--block-text-teal', fallbackHex: '#14b8a6' },
    { value: 'mint_text', labelKey: 'shared.color.mint', fallbackLabel: 'Mint', cssVar: '--block-text-mint', fallbackHex: '#22c55e' },
    { value: 'green_text', labelKey: 'shared.color.green', fallbackLabel: 'Green', cssVar: '--block-text-green', fallbackHex: '#448361' },
    { value: 'lime_text', labelKey: 'shared.color.lime', fallbackLabel: 'Lime', cssVar: '--block-text-lime', fallbackHex: '#84cc16' },
    { value: 'yellow_text', labelKey: 'shared.color.yellow', fallbackLabel: 'Yellow', cssVar: '--block-text-yellow', fallbackHex: '#cb912f' },
    { value: 'orange_text', labelKey: 'shared.color.orange', fallbackLabel: 'Orange', cssVar: '--block-text-orange', fallbackHex: '#d9730d' },
    { value: 'brown_text', labelKey: 'shared.color.brown', fallbackLabel: 'Brown', cssVar: '--block-text-brown', fallbackHex: '#9f6b53' },
    { value: 'slate_text', labelKey: 'shared.color.slate', fallbackLabel: 'Slate', cssVar: '--block-text-slate', fallbackHex: '#64748b' },
    { value: 'gray_text', labelKey: 'shared.color.gray', fallbackLabel: 'Gray', cssVar: '--block-text-gray', fallbackHex: '#787774' },
];

/**
 * 背景颜色预设（顺序与 BlockColorPicker 保持一致）。
 */
const EDITOR_BLOCK_BACKGROUND_COLOR_DEFINITIONS: readonly ColorPickerOptionDefinition<SharedColorMessageKey>[] = [
    { value: 'red_bg', labelKey: 'shared.color.red', fallbackLabel: 'Red', cssVar: '--block-bg-red', fallbackHex: '#ffe2dd' },
    { value: 'crimson_bg', labelKey: 'shared.color.crimson', fallbackLabel: 'Crimson', cssVar: '--block-bg-crimson', fallbackHex: '#fff1f2' },
    { value: 'pink_bg', labelKey: 'shared.color.pink', fallbackLabel: 'Pink', cssVar: '--block-bg-pink', fallbackHex: '#fce8f3' },
    { value: 'purple_bg', labelKey: 'shared.color.purple', fallbackLabel: 'Purple', cssVar: '--block-bg-purple', fallbackHex: '#f3effd' },
    { value: 'indigo_bg', labelKey: 'shared.color.indigo', fallbackLabel: 'Indigo', cssVar: '--block-bg-indigo', fallbackHex: '#eef2ff' },
    { value: 'blue_bg', labelKey: 'shared.color.blue', fallbackLabel: 'Blue', cssVar: '--block-bg-blue', fallbackHex: '#e7f3f8' },
    { value: 'teal_bg', labelKey: 'shared.color.teal', fallbackLabel: 'Teal', cssVar: '--block-bg-teal', fallbackHex: '#f0fdfa' },
    { value: 'mint_bg', labelKey: 'shared.color.mint', fallbackLabel: 'Mint', cssVar: '--block-bg-mint', fallbackHex: '#f0fdf4' },
    { value: 'green_bg', labelKey: 'shared.color.green', fallbackLabel: 'Green', cssVar: '--block-bg-green', fallbackHex: '#edf7ed' },
    { value: 'lime_bg', labelKey: 'shared.color.lime', fallbackLabel: 'Lime', cssVar: '--block-bg-lime', fallbackHex: '#f7fee7' },
    { value: 'yellow_bg', labelKey: 'shared.color.yellow', fallbackLabel: 'Yellow', cssVar: '--block-bg-yellow', fallbackHex: '#fef3c7' },
    { value: 'orange_bg', labelKey: 'shared.color.orange', fallbackLabel: 'Orange', cssVar: '--block-bg-orange', fallbackHex: '#faebdd' },
    { value: 'brown_bg', labelKey: 'shared.color.brown', fallbackLabel: 'Brown', cssVar: '--block-bg-brown', fallbackHex: '#f4eeee' },
    { value: 'slate_bg', labelKey: 'shared.color.slate', fallbackLabel: 'Slate', cssVar: '--block-bg-slate', fallbackHex: '#f1f5f9' },
    { value: 'gray_bg', labelKey: 'shared.color.gray', fallbackLabel: 'Gray', cssVar: '--block-bg-gray', fallbackHex: '#f1f1ef' },
];

export function buildEditorBlockTextColorOptions(
    resolveMessage?: SharedComponentMessageResolver,
): readonly EditorBlockColorOption[] {
    return createColorPickerOptions(EDITOR_BLOCK_TEXT_COLOR_DEFINITIONS, resolveMessage);
}

export function buildEditorBlockBackgroundColorOptions(
    resolveMessage?: SharedComponentMessageResolver,
): readonly EditorBlockColorOption[] {
    return createColorPickerOptions(EDITOR_BLOCK_BACKGROUND_COLOR_DEFINITIONS, resolveMessage);
}

export const EDITOR_BLOCK_TEXT_COLOR_OPTIONS = buildEditorBlockTextColorOptions();
export const EDITOR_BLOCK_BACKGROUND_COLOR_OPTIONS = buildEditorBlockBackgroundColorOptions();
