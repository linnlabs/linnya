import assert from 'node:assert/strict';

/** 只用于隔离 fixture：删除有历史对话的项目，验证退出、历史显式展开和再次选择。 */
export async function runProjectDeletionScenario({ cdp, evaluate, waitFor, projectId }) {
  const name = await evaluate(cdp, `(async () => {
    const { openProjectWorkspaceFromSidebar } = await import('/apps/renderer/app/layout/orchestration/openProjectWorkspaceFromSidebar.ts');
    const { useWorkspaceProjectsStore } = await import('/apps/renderer/domains/workspace/store/WorkspaceProjectsStore.ts');
    const { useLayoutStore } = await import('/apps/renderer/app/layout/store/layoutStore.ts');
    await openProjectWorkspaceFromSidebar(${JSON.stringify(projectId)});
    useLayoutStore().setSidebarNav('list');
    return useWorkspaceProjectsStore().activeProject.name;
  })()`);
  await evaluate(cdp, `(() => {
    const row = Array.from(document.querySelectorAll('.project-row'))
      .find(item => item.querySelector('.project-row-name').textContent.trim() === ${JSON.stringify(name)});
    row.querySelectorAll('button')[1].click();
  })()`);
  await waitFor(() => evaluate(cdp, `document.querySelectorAll('.sidebar-project-menu-wrapper .select-option').length === 3`), '项目操作菜单');
  await evaluate(cdp, `document.querySelectorAll('.sidebar-project-menu-wrapper .select-option')[2].click()`);
  await waitFor(() => evaluate(cdp, `Boolean(document.querySelector('.alert-dialog-footer button'))`), '项目删除确认');
  await evaluate(cdp, `Array.from(document.querySelectorAll('.alert-dialog-footer button')).at(-1).click()`);
  const after = await waitFor(() => evaluate(cdp, `(async () => {
    const { useNavigationScope } = await import('/apps/renderer/app/navigation/index.ts');
    const { useWorkspaceProjectsStore } = await import('/apps/renderer/domains/workspace/store/WorkspaceProjectsStore.ts');
    const { useLayoutStore } = await import('/apps/renderer/app/layout/store/layoutStore.ts');
    if (useWorkspaceProjectsStore().projects.some(item => item.id === ${JSON.stringify(projectId)})) return null;
    if (useNavigationScope().currentScope.kind !== 'linnya-assistant') return null;
    return {
      implicitHistory: Boolean(document.querySelector('[data-sidebar-scroll-viewport] > .sidebar-chat-list')),
      activeDocument: useLayoutStore().state.activeDocument,
      draftScope: useNavigationScope().currentDraft?.scope.kind,
    };
  })()`), '删除完成并退出项目');
  assert.equal(after.implicitHistory, false, '删除不应在项目标题前自动展开无项目历史');
  assert.equal(after.activeDocument, null);
  assert.equal(after.draftScope, 'linnya-assistant');

  await evaluate(cdp, `(async () => {
    const { revealSidebarConversationHistory } = await import('/apps/renderer/app/layout/orchestration/revealSidebarConversationHistory.ts');
    await revealSidebarConversationHistory({ kind: 'linnya-assistant' });
  })()`);
  await waitFor(() => evaluate(cdp, `document.querySelectorAll('[data-sidebar-scroll-viewport] > .sidebar-chat-list .chat-list-item').length > 0`), '主动打开历史仍能看到保留的对话');
  await evaluate(cdp, `document.querySelector('[data-sidebar-scroll-viewport] > .sidebar-chat-list .chat-list-item').click()`);
  await waitFor(() => evaluate(cdp, `Boolean(document.querySelector('[data-sidebar-scroll-viewport] > .sidebar-chat-list .chat-list-item.is-active'))`), '选择无项目历史后列表保持可见');
  console.log('[project-deletion-e2e] 真实删除确认、无隐式历史、保留对话可显式打开和选择通过。');
}
