import { watch } from 'vue';
import { useLayoutStore } from '../store/layoutStore';
import { shouldReloadProjectTreeForVfsRuntimeContextChange } from '../functions/workspaceVfsRuntimeContext';
import { useAssistantStore } from '@/domains/conversation/store/assistantStore';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store/WorkspaceProjectsStore';
import { useWorkspaceTreeStore } from '@/domains/workspace/store/WorkspaceTreeStore';

/**
 * 同步 conversation runtime context 到 workspace VFS。
 *
 * 中文说明：
 * - 会话相关虚拟资源由 app/layout 统一把 conversationId 注入 VFS；
 * - 这个跨 domain 协作不能写在 workspace 文件树组件里，否则 UI 展示会暗中触发树刷新；
 * - app/layout 作为组合层只负责连接两个 domain 的窄状态，不持有具体业务规则。
 */
export function useWorkspaceVfsRuntimeContextSync(): void {
  const assistantStore = useAssistantStore();
  const treeStore = useWorkspaceTreeStore();
  const projectsStore = useWorkspaceProjectsStore();
  const layoutStore = useLayoutStore();

  watch(
    () => assistantStore.activeConversationId,
    async (conversationId, previousConversationId) => {
      const nextConversationId = conversationId || null;
      treeStore.setVfsRuntimeContext({
        conversationId: nextConversationId,
        instanceId: 'default',
      });

      const activeProjectId = projectsStore.activeProjectId;
      if (!activeProjectId) return;

      if (!shouldReloadProjectTreeForVfsRuntimeContextChange({
        previousConversationId: previousConversationId || null,
        nextConversationId,
        sidebarNav: layoutStore.state.sidebarNav,
        sidebarMode: layoutStore.state.sidebarMode,
        activeProjectId,
      })) {
        return;
      }

      await treeStore.loadProjectTree(activeProjectId);
    },
    { immediate: true },
  );
}
