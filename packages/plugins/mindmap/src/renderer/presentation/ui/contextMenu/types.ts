export type MenuAction =
  | 'add_child'
  | 'remove_node'
  | 'focus'
  | 'unfocus'
  | 'move_up'
  | 'move_down'
  | 'summary'
  | 'link'
  | 'link_bidirectional'

export type MenuItem =
  | { isSeparator: true }
  | { isGroup: true; label: string }
  | {
      text: string
      value: MenuAction
      shortcut?: string
      disabled?: boolean
      variant?: 'danger'
      children?: MenuItem[]
    }
