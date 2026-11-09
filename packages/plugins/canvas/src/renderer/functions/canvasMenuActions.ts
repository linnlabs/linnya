import type { CustomSelectOption } from '@linnya/renderer-ui';
import type { CanvasColor } from '@plugin/canvas/shared';
import { canvasChromeColorChoices, canvasMenuIcons } from '../features/canvasChrome';
import { canvasConnectionContextActions } from '../features/connections';

const palette: readonly { readonly color: CanvasColor; readonly text: string }[] = [
  { color: 'white', text: '原色' },
  { color: 'red', text: '红' },
  { color: 'orange', text: '橙' },
  { color: 'yellow', text: '黄' },
  { color: 'green', text: '绿' },
  { color: 'cyan', text: '青' },
  { color: 'purple', text: '紫' },
];
export const canvasColorMenuOptions = palette.map(option => ({
  ...option,
  value: `color:${option.color}`,
}));
const cardColors = new Map(canvasColorMenuOptions.map(option => [option.value, option.color]));
export function readCanvasCardMenuColor(value: string): CanvasColor | null {
  return cardColors.get(value) ?? null;
}
const alignment: readonly CustomSelectOption<string>[] = [
  { value: 'left', text: '左对齐', iconComponent: canvasMenuIcons['align:left'] },
  { value: 'center-x', text: '水平居中', iconComponent: canvasMenuIcons['align:center-x'] },
  { value: 'right', text: '右对齐', iconComponent: canvasMenuIcons['align:right'] },
  { value: 'top', text: '顶部对齐', iconComponent: canvasMenuIcons['align:top'] },
  { value: 'center-y', text: '垂直居中', iconComponent: canvasMenuIcons['align:center-y'] },
  { value: 'bottom', text: '底部对齐', iconComponent: canvasMenuIcons['align:bottom'] },
  { value: 'grid', text: '网格排列', iconComponent: canvasMenuIcons['layout:grid'] },
];
const distribution = [
  { value: 'distribute-x', text: '水平等距分布', iconComponent: canvasMenuIcons['distribute:x'] },
  { value: 'distribute-y', text: '垂直等距分布', iconComponent: canvasMenuIcons['distribute:y'] },
];
const layering = [
  { value: 'front', text: '置于顶层', iconComponent: canvasMenuIcons['layer:front'] },
  { value: 'back', text: '置于底层', iconComponent: canvasMenuIcons['layer:back'] },
];
// 右键菜单的颜色子菜单与选中浮条的颜色菜单同样带纸色色块。
const colors: CustomSelectOption<string> = {
  text: '颜色',
  children: canvasChromeColorChoices(palette, color => `color:${color}`),
};
const align: CustomSelectOption<string> = { text: '对齐', children: alignment };
const distribute: CustomSelectOption<string> = { text: '分布', children: distribution };
const layer: CustomSelectOption<string> = { text: '排列', children: layering };
const separator: CustomSelectOption<string> = { isSeparator: true };
/** 锁定是切换动作：全部已锁才显示“解锁”，与 buildLockCommands 的判定一致。 */
export function canvasCardMenuActions(allLocked: boolean): readonly CustomSelectOption<string>[] {
  return [
    { value: 'lock', text: allLocked ? '解锁' : '锁定' },
    layer,
    align,
    distribute,
    { value: 'arrange', text: '自动排布所选' },
    { value: 'fit-selection', text: '显示选中', shortcut: '⌘2' },
    separator,
    { value: 'delete', text: '删除', shortcut: '⌫', variant: 'danger' },
  ];
}
const cardContext: readonly CustomSelectOption<string>[] = [
  { value: 'ai', text: '加入对话', shortcut: '⌘K' },
  { value: 'edit', text: '编辑或打开', shortcut: '↩' },
  { value: 'copy', text: '复制', shortcut: '⌘C' },
  { value: 'cut', text: '剪切', shortcut: '⌘X' },
  { value: 'duplicate', text: '创建副本', shortcut: '⌘D' },
];
const emptyContext = [
  { value: 'paste', text: '粘贴', shortcut: '⌘V' },
  { value: 'new', text: '新建文字卡' },
  { value: 'document', text: '添加文档…' },
  { value: 'image', text: '添加图片…' },
  { value: 'select-all', text: '全选', shortcut: '⌘A' },
  { value: 'arrange', text: '自动排布' },
  { value: 'fit', text: '显示全部', shortcut: '⌘1' },
];
export function canvasContextMenuActions(input: {
  readonly selectionCount: number;
  /** 纯图片选区没有颜色子菜单；省略时视为可染色。 */
  readonly colorable?: boolean;
  readonly edge: boolean;
  readonly readonly: boolean;
}): readonly CustomSelectOption<string>[] {
  const selected: readonly CustomSelectOption<string>[] =
    input.selectionCount > 1
      ? [
          ...cardContext,
          align,
          distribute,
          { value: 'arrange', text: '自动排布所选' },
          colors,
          layer,
          separator,
          { value: 'delete', text: '删除', shortcut: '⌫', variant: 'danger' },
        ]
      : [
          ...cardContext,
          colors,
          layer,
          { value: 'fit-selection', text: '显示选中', shortcut: '⌘2' },
          separator,
          { value: 'delete', text: '删除', shortcut: '⌫', variant: 'danger' },
        ];
  const actions = input.edge
    ? canvasConnectionContextActions
    : input.selectionCount
      ? input.colorable === false
        ? selected.filter(item => item !== colors)
        : selected
      : emptyContext;
  return input.readonly
    ? actions.filter(
        item =>
          item.value !== undefined &&
          item.value !== null &&
          ['copy', 'ai', 'fit', 'fit-selection', 'jump-from', 'jump-to', 'select-all'].includes(
            item.value
          )
      )
    : actions;
}
