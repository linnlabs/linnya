import assert from 'node:assert/strict';

/** 从已打开的资源文档创建新项目，验证真实弹窗、IPC 和 file session 退出。 */
export async function runCreateProjectAfterDocumentOpen({ cdp, evaluate, waitFor, documentId }) {
  await waitFor(() => evaluate(cdp, `(async () => {
    const { getActiveFileSession } = await import('/apps/renderer/domains/workspace/services/file-manager/index.ts');
    return getActiveFileSession()?.documentId === ${JSON.stringify(documentId)};
  })()`), '旧项目文档 session 完成打开');
  await evaluate(cdp, `(async () => {
    const { useLayoutStore } = await import('/apps/renderer/app/layout/store/layoutStore.ts');
    useLayoutStore().setSidebarNav('list');
  })()`);
  await waitFor(() => evaluate(cdp, `Boolean(document.querySelectorAll('.sidebar-fixed-top .sidebar-entry')[1])`), '新建项目入口');
  await evaluate(cdp, `document.querySelectorAll('.sidebar-fixed-top .sidebar-entry')[1].click()`);
  await waitFor(() => evaluate(cdp, `Boolean(document.querySelector('.create-project-content input'))`), '创建项目弹窗');
  await evaluate(cdp, `(() => {
    const name = document.querySelector('.create-project-content input');
    name.value = 'E2E New Empty Project';
    name.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate(cdp, `document.querySelector('.create-project-content input').dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))`);
  const state = await waitFor(() => evaluate(cdp, `(async () => {
    const { useWorkspaceProjectsStore } = await import('/apps/renderer/domains/workspace/store/WorkspaceProjectsStore.ts');
    const { useWorkspaceTreeStore } = await import('/apps/renderer/domains/workspace/store/WorkspaceTreeStore.ts');
    const { useLayoutStore } = await import('/apps/renderer/app/layout/store/layoutStore.ts');
    const { useNavigationScope } = await import('/apps/renderer/app/navigation/index.ts');
    const { getActiveFileSession } = await import('/apps/renderer/domains/workspace/services/file-manager/index.ts');
    const project = useWorkspaceProjectsStore().activeProject;
    const tree = useWorkspaceTreeStore();
    if (project?.name !== 'E2E New Empty Project' || tree.loadedProjectId !== project.id) return null;
    return {
      projectId: project.id, scopeProjectId: useNavigationScope().currentProjectId,
      treeSize: tree.projectTree.length, activeDocument: useLayoutStore().state.activeDocument,
      activeSession: getActiveFileSession(),
    };
  })()`), '新项目完成导航和文件树加载');
  assert.equal(state.projectId, state.scopeProjectId);
  assert.equal(state.treeSize, 0);
  assert.equal(state.activeDocument, null);
  assert.equal(state.activeSession, null);
  console.log('[project-creation-e2e] 新项目空树、旧文档保存退出和项目身份一致通过。');
}
