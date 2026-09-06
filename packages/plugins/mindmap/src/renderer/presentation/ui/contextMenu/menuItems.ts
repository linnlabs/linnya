import type { MenuItem } from './types'

export function buildMindMapContextMenuItems(params: { isRootNode: boolean }): MenuItem[] {
  return [
    { text: '新增子主题', value: 'add_child', shortcut: 'Tab' },
    { isSeparator: true },
    { text: '聚焦主题', value: 'focus', disabled: params.isRootNode },
    { text: '取消聚焦', value: 'unfocus' },
    { text: '上移主题', value: 'move_up', disabled: params.isRootNode },
    { text: '下移主题', value: 'move_down', disabled: params.isRootNode },
    { text: '创建摘要', value: 'summary' },
    { text: '创建单向连接', value: 'link' },
    { text: '创建双向连接', value: 'link_bidirectional' },
    { isSeparator: true },
    {
      text: '删除主题',
      value: 'remove_node',
      shortcut: 'Delete',
      disabled: params.isRootNode,
      variant: 'danger',
    },
  ]
}
