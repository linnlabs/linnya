import type {
  DocumentTabShortcut,
  DocumentTabShortcutDecision,
  DocumentTabShortcutInput,
} from '../definitions/documentTabShortcut';

function readShortcut(input: DocumentTabShortcutInput): DocumentTabShortcut | null {
  const mod = input.isMac ? input.metaKey : input.ctrlKey;
  const key = input.key.toLowerCase();
  if (input.ctrlKey && key === 'tab') return { kind: 'cycle', offset: input.shiftKey ? -1 : 1 };
  if (mod && !input.altKey && key === 'w' && !input.shiftKey) return { kind: 'close' };
  if (mod && !input.altKey && key === 't' && input.shiftKey) return { kind: 'reopen' };
  return null;
}

/**
 * 标签栏快捷键的处理规则。
 *
 * 弹窗开着时快捷键不作用于被盖住的标签（此前在设置里按 ⌘W 会关掉背后的文档），
 * 但仍要接住：放行的 ⌘W 会落到 Electron 默认菜单，关掉整个窗口。
 * 没有弹窗、也没有可关的标签时 ⌘W 照旧交给系统。
 */
export function decideDocumentTabShortcut(input: DocumentTabShortcutInput): DocumentTabShortcutDecision {
  const shortcut = readShortcut(input);
  if (!shortcut) return { kind: 'pass' };
  if (input.modalOpen) return { kind: 'swallow' };
  if (shortcut.kind === 'close' && !input.hasActiveTab) return { kind: 'pass' };
  return { kind: 'run', shortcut };
}
