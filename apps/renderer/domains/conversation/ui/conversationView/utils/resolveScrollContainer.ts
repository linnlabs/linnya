/**
 * 从 conversation 根节点向上解析真实滚动容器。
 *
 * 规则：
 * - 若页面显式标记了统一 viewport（如 OverlayScrollbars 试点），优先返回该 viewport
 * - 默认返回 `.conversation-view` 自身
 * - 在 WORKSPACE 下，真实滚动容器是外层 `.messages-viewport`
 */
export function resolveScrollContainer(rootEl: HTMLElement): HTMLElement {
  const explicitViewport = rootEl.closest('[data-conversation-scroll-viewport="true"]');
  if (explicitViewport instanceof HTMLElement) {
    return explicitViewport;
  }

  const projectWorkspaceViewport = rootEl.closest('.messages-viewport');
  if (projectWorkspaceViewport instanceof HTMLElement) {
    return projectWorkspaceViewport;
  }

  return rootEl;
}
