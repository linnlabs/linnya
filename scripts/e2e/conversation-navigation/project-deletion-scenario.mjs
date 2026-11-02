import assert from 'node:assert/strict';

/** 只用于隔离 fixture：删除项目连同对话，另一项目的历史仍可正常打开。 */
export async function runProjectDeletionScenario({ cdp, evaluate, waitFor, projectId, retainedProjectId }) {
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
  const confirmation = await evaluate(cdp, `document.querySelector('.alert-dialog-message').textContent`);
  assert.match(confirmation, /全部对话及其关联数据|all conversations, and associated data/);
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
  await waitFor(() => evaluate(cdp, `Boolean(document.querySelector('[data-sidebar-scroll-viewport] > .sidebar-chat-list .chat-list-state'))`), '无项目历史为空');
  assert.equal(await evaluate(cdp, `document.querySelectorAll('[data-sidebar-scroll-viewport] > .sidebar-chat-list .chat-list-item').length`), 0);
  await evaluate(cdp, `(async () => {
    const { revealSidebarConversationHistory } = await import('/apps/renderer/app/layout/orchestration/revealSidebarConversationHistory.ts');
    await revealSidebarConversationHistory({ kind: 'project', projectId: ${JSON.stringify(retainedProjectId)} });
  })()`);
  await waitFor(() => evaluate(cdp, `document.querySelectorAll('.project-chat-panel .chat-list-item').length === 1`), '另一项目仍有一条历史');
  await evaluate(cdp, `document.querySelector('.project-chat-panel .chat-list-item').click()`);
  await waitFor(() => evaluate(cdp, `Boolean(document.querySelector('.project-chat-panel .chat-list-item.is-active'))`), '另一项目对话仍可打开');
  console.log('[project-deletion-e2e] 确认框范围、项目会话删除、不转成无项目历史、另一项目保持正常通过。');
}
