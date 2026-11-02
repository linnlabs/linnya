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
  await evaluate(cdp, `(async () => {
    const { projectGateway } = await import('/apps/renderer/shared/ipc/projectGateway.ts');
    const originalList = projectGateway.list;
    let refreshCount = 0;
    // 将创建回执的第二次读取延迟到位移动画中段，复现相同快照迟到。
    projectGateway.list = async () => {
      const response = await originalList();
      if (++refreshCount === 2) await new Promise(resolve => setTimeout(resolve, 140));
      return response;
    };
    const rows = Array.from(document.querySelectorAll('.sidebar-project-group'));
    const probe = { rows, transitions: [], startedAt: performance.now(), samples: [] };
    const onTransition = (event) => {
      if (event.target.matches('.sidebar-project-group')) {
        probe.transitions.push({ existing: rows.includes(event.target), row: rows.indexOf(event.target), property: event.propertyName, type: event.type, at: performance.now() - probe.startedAt });
      }
    };
    for (const type of ['transitionstart', 'transitioncancel', 'transitionend']) document.addEventListener(type, onTransition);
    let frame;
    const sample = () => {
      probe.samples.push({ at: performance.now() - probe.startedAt, y: rows[0]?.getBoundingClientRect().top });
      frame = requestAnimationFrame(sample);
    };
    sample();
    probe.stop = () => {
      cancelAnimationFrame(frame);
      projectGateway.list = originalList;
      for (const type of ['transitionstart', 'transitioncancel', 'transitionend']) document.removeEventListener(type, onTransition);
    };
    window.__projectCreationProbe = probe;
  })()`);
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
  const motion = await waitFor(() => evaluate(cdp, `(() => {
    const probe = window.__projectCreationProbe;
    const inserted = document.querySelector('.sidebar-project-group');
    const moving = probe.transitions.some(item => item.existing && item.property === 'transform');
    const fading = probe.transitions.some(item => !item.existing && item.property === 'opacity');
    if (performance.now() - probe.startedAt < 1000) return null;
    probe.stop();
    return {
      retained: probe.rows.every(row => row.isConnected),
      rowCount: probe.rows.length,
      firstName: inserted.querySelector('.project-row-name').textContent.trim(),
      moving, fading, transitions: probe.transitions, samples: probe.samples,
    };
  })()`), '既有项目向下移动与新项目淡入');
  assert(motion.rowCount > 0 && motion.samples.length > 2, '必须观察到真实绘制帧与既有项目');
  for (let row = 0; row < motion.rowCount; row += 1) {
    const transitions = motion.transitions.filter(event => event.row === row && event.property === 'transform');
    assert.equal(transitions.filter(event => event.type === 'transitionstart').length, 1, '既有项目只下移一次');
    assert.equal(transitions.some(event => event.type === 'transitioncancel'), false, '位移不能中途被打断');
  }
  assert.equal(motion.fading, true, '新项目应淡入');
  assert(motion.samples.at(-1).y > motion.samples[0].y, '后方项目实际下移');
  assert(motion.samples.every((sample, index) => index === 0 || sample.y >= motion.samples[index - 1].y - 1), '插入位移不能倒退');
  assert.equal(motion.retained, true, '创建不能卸载原项目列表');
  assert.equal(motion.firstName, 'E2E New Empty Project');
  console.log('[project-creation-e2e] 新项目空树、旧文档退出、顶部插入、旧节点保留和实际位移/淡入通过。');
  return state.projectId;
}

/** 预热为空后首次挂载不能重新塞入五行骨架；测量真实抽屉和后方项目的位移。 */
export async function runEmptyProjectExpansion({ cdp, evaluate, projectId }) {
  const motion = await evaluate(cdp, `(async () => {
    const { historyApiService } = await import('/apps/renderer/domains/conversation/history/services/historyApiService.ts');
    const { useHistoryListStore } = await import('/apps/renderer/domains/conversation/history/store/historyListStore.ts');
    const hadLoaded = useHistoryListStore().hasLoadedScope({ kind: 'project', projectId: ${JSON.stringify(projectId)} });
    const fetchList = historyApiService.fetchList;
    let requests = 0;
    historyApiService.fetchList = async (...args) => {
      requests += 1;
      const result = await fetchList.apply(historyApiService, args);
      await new Promise(resolve => setTimeout(resolve, 80));
      return result;
    };
    const group = document.querySelector('.sidebar-project-group');
    const following = group.nextElementSibling;
    const samples = [];
    let frame;
    const sample = () => {
      samples.push({
        y: following.getBoundingClientRect().top,
        height: group.querySelector('.project-collapse')?.getBoundingClientRect().height ?? 0,
        skeleton: Boolean(group.querySelector('.chat-list-skeleton')),
      });
      frame = requestAnimationFrame(sample);
    };
    sample();
    try {
      group.querySelector('.project-row').click();
      await new Promise(resolve => setTimeout(resolve, 1000));
      return { samples, requests, hadLoaded, text: group.querySelector('.chat-list-state')?.textContent.trim() };
    } finally {
      cancelAnimationFrame(frame);
      historyApiService.fetchList = fetchList;
    }
  })()`);
  console.log('[empty-project-motion]', JSON.stringify({ requests: motion.requests, maxHeight: Math.max(...motion.samples.map(sample => sample.height)), finalHeight: motion.samples.at(-1).height, skeleton: motion.samples.some(sample => sample.skeleton) }));
  assert.equal(motion.requests, motion.hadLoaded ? 0 : 1, '预热完成后挂载不应重新请求同一份空历史');
  assert.equal(motion.samples.some(sample => sample.skeleton), false, '已知为空的项目不能闪现骨架');
  const final = motion.samples.at(-1);
  assert(final.height > 0 && motion.text, '展开后应显示暂无对话');
  assert(Math.max(...motion.samples.map(sample => sample.height)) <= final.height + 1, '抽屉不能先撑大后回缩');
  assert(Math.max(...motion.samples.map(sample => sample.y)) <= final.y + 1, '后方项目不能向下越过最终位置再闪回');
}
