export const canvasCardMenuActions = [
  { value: 'lock', text: '锁定 / 解锁' }, { value: 'front', text: '置于顶层' }, { value: 'back', text: '置于底层' },
  { value: 'left', text: '左对齐' }, { value: 'center-x', text: '水平居中' }, { value: 'right', text: '右对齐' },
  { value: 'top', text: '顶部对齐' }, { value: 'center-y', text: '垂直居中' }, { value: 'bottom', text: '底部对齐' },
  { value: 'distribute-x', text: '水平等距分布' }, { value: 'distribute-y', text: '垂直等距分布' }, { value: 'grid', text: '网格排列' },
  { value: 'fit-selection', text: '显示选中 ⌘2' }, { value: 'delete', text: '删除' },
];
const cardContext = [{ value: 'ai', text: '加入对话 ⌘K' }, { value: 'edit', text: '编辑或打开 ↩' }, { value: 'copy', text: '复制 ⌘C' }, { value: 'cut', text: '剪切 ⌘X' }, { value: 'duplicate', text: '创建副本 ⌘D' }];
const edgeContext = [{ value: 'label', text: '编辑标签 ↩' }, { value: 'reverse', text: '反转方向' }, { value: 'jump-from', text: '跳到起点' }, { value: 'jump-to', text: '跳到终点' }, { value: 'delete', text: '删除连线 ⌫' }];
const emptyContext = [{ value: 'paste', text: '粘贴 ⌘V' }, { value: 'new', text: '新建文字卡' }, { value: 'document', text: '添加文档…' }, { value: 'image', text: '添加图片…' }, { value: 'select-all', text: '全选 ⌘A' }, { value: 'arrange', text: '自动排布' }, { value: 'fit', text: '显示全部 ⌘1' }];
export function canvasContextMenuActions(input: { readonly selectionCount: number; readonly edge: boolean; readonly readonly: boolean }) {
  const actions = input.edge ? edgeContext : input.selectionCount ? [...cardContext, ...canvasCardMenuActions] : emptyContext;
  return input.readonly ? actions.filter(item => ['copy', 'ai', 'fit', 'fit-selection', 'jump-from', 'jump-to', 'select-all'].includes(item.value)) : actions;
}
