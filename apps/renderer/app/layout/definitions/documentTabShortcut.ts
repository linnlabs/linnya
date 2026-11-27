/** 标签栏的三个快捷键：Ctrl+Tab 按最近使用切换、⌘W 关闭当前标签、⇧⌘T 重新打开刚关的标签。 */
export type DocumentTabShortcut =
  | { readonly kind: 'cycle'; readonly offset: 1 | -1 }
  | { readonly kind: 'close' }
  | { readonly kind: 'reopen' };

/** 一次按键怎么处理。 */
export type DocumentTabShortcutDecision =
  /** 不是标签快捷键，或者交给系统处理（没有可关的标签时 ⌘W 由默认菜单关闭窗口）。 */
  | { readonly kind: 'pass' }
  /** 弹窗盖着标签栏：接住按键，但不动背后的标签。 */
  | { readonly kind: 'swallow' }
  | { readonly kind: 'run'; readonly shortcut: DocumentTabShortcut };

export interface DocumentTabShortcutInput {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly isMac: boolean;
  /** 有没有打开的模态浮层（设置窗、弹窗、确认框、图片预览）。 */
  readonly modalOpen: boolean;
  readonly hasActiveTab: boolean;
}
