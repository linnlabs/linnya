import type { CustomSelectOption } from '@linnya/renderer-ui';
import type { CanvasColor } from '@plugin/canvas/shared';
import { canvasConnectionContextActions } from '../features/connections';

const palette: readonly { readonly color: CanvasColor; readonly text: string }[] = [
  { color: 'white', text: '原色' }, { color: 'red', text: '红' }, { color: 'orange', text: '橙' }, { color: 'yellow', text: '黄' },
  { color: 'green', text: '绿' }, { color: 'cyan', text: '青' }, { color: 'purple', text: '紫' },
];
export const canvasColorMenuOptions = palette.map(option => ({ ...option, value: `color:${option.color}` }));
const cardColors = new Map(canvasColorMenuOptions.map(option => [option.value, option.color]));
export function readCanvasCardMenuColor(value: string): CanvasColor | null { return cardColors.get(value) ?? null; }
const alignment: readonly CustomSelectOption<string>[] = [
  { value: 'left', text: '左对齐' }, { value: 'center-x', text: '水平居中' }, { value: 'right', text: '右对齐' },
  { value: 'top', text: '顶部对齐' }, { value: 'center-y', text: '垂直居中' }, { value: 'bottom', text: '底部对齐' }, { value: 'grid', text: '网格排列' },
];
const distribution = [{ value: 'distribute-x', text: '水平等距分布' }, { value: 'distribute-y', text: '垂直等距分布' }];
const layering = [{ value: 'front', text: '置于顶层' }, { value: 'back', text: '置于底层' }];
const colors: CustomSelectOption<string> = { text: '颜色', children: canvasColorMenuOptions };
const align: CustomSelectOption<string> = { text: '对齐', children: alignment };
const distribute: CustomSelectOption<string> = { text: '分布', children: distribution };
const layer: CustomSelectOption<string> = { text: '排列', children: layering };
export const canvasCardMenuActions: readonly CustomSelectOption<string>[] = [
  { value: 'lock', text: '锁定 / 解锁' }, layer, align, distribute,
  { value: 'arrange', text: '自动排布所选' }, { value: 'fit-selection', text: '显示选中 ⌘2' }, { value: 'delete', text: '删除' },
];
const cardContext: readonly CustomSelectOption<string>[] = [
  { value: 'ai', text: '加入对话 ⌘K' }, { value: 'edit', text: '编辑或打开 ↩' },
  { value: 'copy', text: '复制 ⌘C' }, { value: 'cut', text: '剪切 ⌘X' }, { value: 'duplicate', text: '创建副本 ⌘D' },
];
const emptyContext = [{ value: 'paste', text: '粘贴 ⌘V' }, { value: 'new', text: '新建文字卡' }, { value: 'document', text: '添加文档…' }, { value: 'image', text: '添加图片…' }, { value: 'select-all', text: '全选 ⌘A' }, { value: 'arrange', text: '自动排布' }, { value: 'fit', text: '显示全部 ⌘1' }];
export function canvasContextMenuActions(input: { readonly selectionCount: number; readonly edge: boolean; readonly readonly: boolean }): readonly CustomSelectOption<string>[] {
  const selected = input.selectionCount > 1 ? [...cardContext, align, distribute, { value: 'arrange', text: '自动排布所选' }, colors, layer, { value: 'delete', text: '删除' }] : [...cardContext, colors, layer, { value: 'fit-selection', text: '显示选中 ⌘2' }, { value: 'delete', text: '删除' }];
  const actions = input.edge ? canvasConnectionContextActions : input.selectionCount ? selected : emptyContext;
  return input.readonly ? actions.filter(item => item.value !== undefined && item.value !== null && ['copy', 'ai', 'fit', 'fit-selection', 'jump-from', 'jump-to', 'select-all'].includes(item.value)) : actions;
}
