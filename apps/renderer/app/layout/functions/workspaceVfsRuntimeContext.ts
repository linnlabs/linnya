import type { SidebarMode, SidebarNav } from '../definitions/layoutState';

export interface WorkspaceVfsRuntimeContextChange {
  previousConversationId: string | null | undefined;
  nextConversationId: string | null;
  sidebarNav: SidebarNav;
  sidebarMode: SidebarMode;
  activeProjectId: string | null;
}

/**
 * 判断 conversation runtime context 变化后是否需要立即刷新当前项目树。
 *
 * 中文说明：
 * - VFS 的会话相关虚拟资源依赖当前 conversationId；
 * - 只有文件模式正在展示项目树时，conversationId 变化才需要立即 reload；
 * - 这个规则属于 app-level 编排，不属于 workspace 文件树展示组件。
 */
export function shouldReloadProjectTreeForVfsRuntimeContextChange(
  input: WorkspaceVfsRuntimeContextChange,
): boolean {
  if (input.previousConversationId === input.nextConversationId) return false;
  if (input.sidebarNav !== 'project') return false;
  if (input.sidebarMode !== 'files') return false;
  return Boolean(input.activeProjectId);
}
