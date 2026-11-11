import { useWorkspaceTreeStateStore } from './store/WorkspaceTreeStore';
import { createWorkspaceTreeLoader } from './features/tree-loading/orchestration/createWorkspaceTreeLoader';
import { createWorkspaceTreeNodeMutations } from './features/tree-node-mutations/orchestration/createWorkspaceTreeNodeMutations';
export type { WorkspaceNode } from './definitions/workspaceTree';

const runtimes = new WeakMap<ReturnType<typeof useWorkspaceTreeStateStore>, ReturnType<typeof createWorkspaceTreeRuntime>>();

/** 工作区树公开入口：状态与请求 owner 按同一个 Pinia 实例绑定，组件只发命令。 */
export function useWorkspaceTree() {
  const store = useWorkspaceTreeStateStore();
  let runtime = runtimes.get(store);
  if (!runtime) {
    runtime = createWorkspaceTreeRuntime(store);
    runtimes.set(store, runtime);
  }
  return runtime;
}

function createWorkspaceTreeRuntime(store: ReturnType<typeof useWorkspaceTreeStateStore>) {
  const loader = createWorkspaceTreeLoader(store);
  const mutations = createWorkspaceTreeNodeMutations({
    setError: store.setError,
    patchNode: store.patchNode,
    findNodeById: store.findNodeById,
    loadNodeChildren: loader.loadNodeChildren,
    reloadActiveProjectTree: loader.reloadActiveProjectTree,
    setRenameRequestNodeId: store.setRenameRequestNodeId,
    markNodeAsNew: store.markNodeAsNew,
  });
  return {
    ...loader, ...mutations,
    get projectTree() { return store.projectTree; },
    get loadedProjectId() { return store.loadedProjectId; },
    get loadingProjectId() { return store.loadingProjectId; },
    get renameRequestNodeId() { return store.renameRequestNodeId; },
    get isLoading() { return store.isLoading; },
    get error() { return store.error; },
    get newNodeFlags() { return store.newNodeFlags; },
    get flatProjectTree() { return store.flatProjectTree; },
    setRenameRequestNodeId: store.setRenameRequestNodeId,
    markNodeAsNew: store.markNodeAsNew,
    clearNodeNewFlag: store.clearNodeNewFlag,
    clearAllNewFlags: store.clearAllNewFlags,
    setVfsRuntimeContext: store.setVfsRuntimeContext,
    findNodeById: store.findNodeById,
    isDescendant: store.isDescendant,
    isNodeNew: store.isNodeNew,
  };
}
