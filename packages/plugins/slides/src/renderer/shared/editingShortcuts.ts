/** 菜单里展示的快捷键文字；只用于已经实现的快捷键。 */
export function formatEditingShortcut(key: string): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.platform);
  return mac ? `⌘${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`;
}
