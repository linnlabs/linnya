import { nextTick } from 'vue';
import { useLayoutStore } from '@/app/layout/store/layoutStore';
import type { ActiveDocument, ActiveDocumentType } from '@/app/layout/definitions/layoutState';
import {
  resolveConversationNavigationPlan,
  resolveDocumentNavigationPlan,
} from '@/app/layout/functions/workspacePaneNavigationPlan';
import { computeWorkspacePanePlacementSwapPreferredWidth } from '@/app/layout/functions/workspacePaneGeometry';
import {
  areWorkspaceScopesEqual,
  useWorkspaceScopeStore,
  type WorkspaceScope,
} from '@/shared/stores/workspaceScopeStore';
import { useFileStore } from '@/shared/stores/file';
import type {
  WorkspaceDocumentNavigationRequest,
  WorkspaceNavigationDocumentType,
  WorkspaceNavigationPort,
  WorkspaceNavigationScope,
} from '@/shared/ports/workspaceNavigationPort';
import { getDocumentSurfaceRuntimePort } from '@/shared/ports/documentSurfaceRuntimePort';
import { activateFileSession, getActiveFileSession, saveDeactivateThen } from '@/domains/workspace/services/file-manager';
import { getDocumentRuntimeLoaderByActiveType, getDocumentTypeByActiveType } from '@/app/plugins/registry';
import type {
  DocumentRuntimeLoaderContribution,
  DocumentRuntimeLoadRequest,
  DocumentTypeContribution,
} from '@/app/plugins/types';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import { useWorkspaceTreeStore } from '@/domains/workspace/store/WorkspaceTreeStore';
import { useHistoryLoaderStore } from '@/domains/conversation/history/store/historyLoaderStore';
import type { HistoryLoadingIntent } from '@/domains/conversation/history/definitions/historyLoader';
import { useAssistantStore } from '@/domains/conversation/store/assistantStore';
import { useProjectOverviewModalStore } from '@/domains/workspace/features/project-overview/store/projectOverviewModalStore';

interface DocumentOpenIntent {
  id: number;
  controller: AbortController;
}

let documentOpenIntentSeq = 0;
let currentDocumentOpenIntent: DocumentOpenIntent | null = null;
let panePlacementSwapTransitionToken = 0;

function scheduleAfterNextPaint(callback: () => void): void {
  if (typeof globalThis.requestAnimationFrame !== 'function') {
    globalThis.setTimeout(callback, 0);
    return;
  }

  globalThis.requestAnimationFrame(() => {
    globalThis.requestAnimationFrame(callback);
  });
}

function runWithoutWorkspacePanePlacementTransition(action: () => void): void {
  const body = globalThis.document?.body;
  if (!body) {
    action();
    return;
  }

  const token = panePlacementSwapTransitionToken + 1;
  panePlacementSwapTransitionToken = token;
  body.classList.add('workspace-pane-placement-swapping');

  try {
    action();
  } finally {
    // 交换主/侧 pane 是语义位置切换，不能播放展开/折叠动画；
    // 等浏览器完成本次布局提交后再恢复普通右侧栏动画。
    scheduleAfterNextPaint(() => {
      if (panePlacementSwapTransitionToken === token) {
        body.classList.remove('workspace-pane-placement-swapping');
      }
    });
  }
}

function beginDocumentOpenIntent(): DocumentOpenIntent {
  currentDocumentOpenIntent?.controller.abort();
  const intent: DocumentOpenIntent = {
    id: documentOpenIntentSeq + 1,
    controller: new AbortController(),
  };
  documentOpenIntentSeq = intent.id;
  currentDocumentOpenIntent = intent;
  return intent;
}

function cancelDocumentOpenIntent(): void {
  currentDocumentOpenIntent?.controller.abort();
  currentDocumentOpenIntent = null;
}

function isCurrentDocumentOpenIntent(intent: DocumentOpenIntent): boolean {
  return currentDocumentOpenIntent?.id === intent.id && !intent.controller.signal.aborted;
}

async function waitForDocumentSurfaceIntent(intent: DocumentOpenIntent, document: ActiveDocument): Promise<boolean> {
  try {
    await getDocumentSurfaceRuntimePort().waitForSurfaceReady(document, {
      signal: intent.controller.signal,
    });
  } catch (error) {
    if (intent.controller.signal.aborted) {
      return false;
    }
    throw error;
  }

  return isCurrentDocumentOpenIntent(intent);
}

function toActiveDocumentType(type: WorkspaceNavigationDocumentType): ActiveDocumentType {
  return type;
}

function resolveDocumentType(type: WorkspaceNavigationDocumentType): DocumentTypeContribution {
  const documentType = getDocumentTypeByActiveType(type);
  if (!documentType) {
    throw new Error(`[workspaceNavigation] unsupported document type: ${type}`);
  }
  if (!useEnabledPluginsStore().isPluginEnabled(documentType.pluginId)) {
    throw new Error(`[workspaceNavigation] document type plugin disabled: ${documentType.pluginId}`);
  }
  return documentType;
}

function getRequiredFileSessionType(documentType: DocumentTypeContribution): string {
  if (!documentType.fileSessionType) {
    throw new Error(`[workspaceNavigation] ${documentType.activeDocumentType} is not registered in file-manager`);
  }
  return documentType.fileSessionType;
}

function getRequiredDocumentRuntimeLoader(
  documentType: DocumentTypeContribution,
): DocumentRuntimeLoaderContribution {
  const loader = getDocumentRuntimeLoaderByActiveType(
    documentType.activeDocumentType,
    useEnabledPluginsStore().enabledPluginIds,
  );
  if (!loader) {
    throw new Error(`[workspaceNavigation] ${documentType.activeDocumentType} is not registered for runtime loading`);
  }
  return loader;
}

function cloneWorkspaceScope(scope: WorkspaceScope): WorkspaceScope {
  return scope.kind === 'project'
    ? { kind: 'project', projectId: scope.projectId }
    : { kind: 'linnya-assistant' };
}

function resolveDocumentProjectId(request: WorkspaceDocumentNavigationRequest): string {
  if (request.projectId) return request.projectId;

  const treeStore = useWorkspaceTreeStore();
  const node = treeStore.findNodeById(request.documentId);
  if (node?.projectId) return node.projectId;

  const workspaceScopeStore = useWorkspaceScopeStore();
  if (workspaceScopeStore.currentProjectId) return workspaceScopeStore.currentProjectId;

  throw new Error('[workspaceNavigation] projectId is required when opening a workspace document');
}

function setWorkspaceScope(scope: WorkspaceNavigationScope): void {
  const workspaceScopeStore = useWorkspaceScopeStore();
  if (scope.kind === 'project') {
    workspaceScopeStore.enterProject(scope.projectId);
    return;
  }
  workspaceScopeStore.enterLinnyaAssistant();
}

function setWorkspaceView(scope: WorkspaceNavigationScope): void {
  useProjectOverviewModalStore().close();
  setWorkspaceScope(scope);
}

/**
 * active page 离开当前项目后进入文件空态。
 * 中文说明：此路径不能再次保存已经删除或转移的 page；调用方必须先完成 file-manager deactivate。
 */
export function showEmptyProjectFilesAfterRemoval(projectId: string): void {
  cancelDocumentOpenIntent();
  setWorkspaceView({ kind: 'project', projectId });
  useLayoutStore().openEmptyFilesWorkspace();
}

async function leaveDocumentRuntimeThen(action: () => void | Promise<void>): Promise<void> {
  cancelDocumentOpenIntent();
  await saveDeactivateThen(action);
}

async function saveCurrentSessionBeforeReplacingSurface(
  nextSession: { documentId: string; type: string } | null
): Promise<void> {
  const activeSession = getActiveFileSession();
  if (!activeSession) return;
  if (
    nextSession
    && activeSession.documentId === nextSession.documentId
    && activeSession.type === nextSession.type
  ) {
    return;
  }

  // 旧文档 surface 仍挂载时先完成保存和 deactivate。
  // 如果先切 layoutStore.activeDocument，MarkdownEditorPage 会被卸载，
  // 随后的 view-switch 保存就拿不到 editor runtime。
  await saveDeactivateThen(async () => {});
}

export function createWorkspaceNavigation(): WorkspaceNavigationPort {
  return {
    async openWorkspace(scope) {
      const layoutStore = useLayoutStore();
      const workspaceScopeStore = useWorkspaceScopeStore();
      const isSameScope = areWorkspaceScopesEqual(workspaceScopeStore.currentScope, scope);
      const isAlreadyInWorkspace = layoutStore.state.scene.kind === 'workspace';

      if (isSameScope && isAlreadyInWorkspace) {
        // 中文说明：重复进入当前工作区只是聚焦项目壳，不能重置正在查看的对话或文件。
        setWorkspaceView(scope);
        if (scope.kind === 'linnya-assistant') {
          layoutStore.setSidebarNav('list');
        }
        return;
      }

      await leaveDocumentRuntimeThen(() => {
        setWorkspaceView(scope);
        layoutStore.openChatWorkspace();
        if (scope.kind === 'linnya-assistant') {
          layoutStore.setSidebarNav('list');
        }
      });
    },

    async openEmptyProjectFiles(projectId) {
      await leaveDocumentRuntimeThen(() => {
        setWorkspaceView({ kind: 'project', projectId });
        useLayoutStore().openEmptyFilesWorkspace();
      });
    },

    async openKnowledgeBase() {
      await leaveDocumentRuntimeThen(() => {
        const layoutStore = useLayoutStore();
        useProjectOverviewModalStore().close();
        layoutStore.openBypassView({ type: 'knowledge-base' });
      });

      // 中文说明：知识库页面的数据预热属于导航进入该 scene 的编排职责，
      // 不能散落在 UI 偏好 store 或页面组件里。
      const { useKnowledgeBaseStore } = await import('@/domains/knowledgebase/stores/knowledgeBase.js');
      const kbStore = useKnowledgeBaseStore();
      await kbStore.ensureDataLoaded();
    },

    async openPluginStore() {
      await leaveDocumentRuntimeThen(() => {
        const layoutStore = useLayoutStore();
        useProjectOverviewModalStore().close();
        layoutStore.setSidebarNav('list');
        layoutStore.openBypassView({ type: 'plugin-store' });
      });
    },

    async openProjectSetup(projectId) {
      await leaveDocumentRuntimeThen(() => {
        const layoutStore = useLayoutStore();
        const workspaceScopeStore = useWorkspaceScopeStore();
        useProjectOverviewModalStore().close();
        workspaceScopeStore.enterProject(projectId);
        layoutStore.openBypassView({ type: 'project-setup', projectId });
      });
    },

    toggleWorkspacePanePlacement() {
      const layoutStore = useLayoutStore();
      const swappedRightPaneWidth = computeWorkspacePanePlacementSwapPreferredWidth(
        layoutStore.state,
        layoutStore.workspaceStageWidth,
      );
      runWithoutWorkspacePanePlacementTransition(() => {
        layoutStore.toggleWorkspacePanePlacement(swappedRightPaneWidth);
      });
    },

    toggleWorkspaceRightPaneVisibility() {
      const layoutStore = useLayoutStore();
      layoutStore.toggleWorkspaceRightPaneVisibility();
    },

    async closeWorkspaceDocument() {
      cancelDocumentOpenIntent();
      const layoutStore = useLayoutStore();

      await saveDeactivateThen(async () => {
        const activeDocumentProjectId = layoutStore.state.activeDocument?.projectId ?? null;
        layoutStore.closeDocument();
        if (activeDocumentProjectId) {
          setWorkspaceView({ kind: 'project', projectId: activeDocumentProjectId });
          layoutStore.openChatWorkspace();
          return;
        }
        setWorkspaceView({ kind: 'linnya-assistant' });
        layoutStore.openChatWorkspace();
      });
    },

    async openDocumentTarget(request) {
      const projectId = resolveDocumentProjectId(request);
      const documentType = resolveDocumentType(request.type);
      if (documentType.fileSessionType) {
        throw new Error(
          `[workspaceNavigation] openDocumentTarget requires runtime loader document type: ${documentType.activeDocumentType}`,
        );
      }
      const documentRuntimeLoader = getRequiredDocumentRuntimeLoader(documentType);
      const fileStore = useFileStore();
      const layoutStore = useLayoutStore();
      const intent = beginDocumentOpenIntent();
      useProjectOverviewModalStore().close();
      setWorkspaceScope({ kind: 'project', projectId });
      await saveCurrentSessionBeforeReplacingSurface(null);
      if (!isCurrentDocumentOpenIntent(intent)) return;
      layoutStore.openDocument({
        id: request.documentId,
        projectId,
        type: toActiveDocumentType(request.type),
      });
      fileStore.setFilePath(request.documentId, request.displayName ?? null);
      await nextTick();
      const isReadyForIntent = await waitForDocumentSurfaceIntent(intent, {
        id: request.documentId,
        projectId,
        type: toActiveDocumentType(request.type),
      });
      if (!isReadyForIntent) return;
      const runtimeLoadRequest: DocumentRuntimeLoadRequest = {
        documentId: request.documentId,
        projectId,
        displayName: request.displayName ?? null,
        parentId: request.parentId ?? null,
        ...(request.parameters ? { parameters: request.parameters } : {}),
      };
      await documentRuntimeLoader.load(runtimeLoadRequest);
    },

    async openConversation(request) {
      const layoutStore = useLayoutStore();
      const workspaceScopeStore = useWorkspaceScopeStore();
      const historyLoaderStore = useHistoryLoaderStore();
      const previousScope = cloneWorkspaceScope(workspaceScopeStore.currentScope);
      const plan = resolveConversationNavigationPlan(
        layoutStore.state,
        areWorkspaceScopesEqual(previousScope, request.scope),
      );
      const initialConversation = request.initialConversation
        ? {
            title: request.initialConversation.title,
            created_at: request.initialConversation.createdAt,
            last_event_at: request.initialConversation.lastEventAt,
            user_message_count: request.initialConversation.userMessageCount,
            project_id: request.initialConversation.projectId,
            mode: request.initialConversation.mode,
          }
        : null;
      const applyConversationLayout = () => {
        if (plan.placement === 'right-pane') {
          layoutStore.openConversationInRightPane();
          return;
        }

        layoutStore.openConversationInMainPane({
          secondaryPane: plan.closeSecondaryPane ? 'close-document' : 'preserve-document',
        });
      };

      let loadingIntent: HistoryLoadingIntent | null = null;
      const beginHistoryLoadingIntent = () => {
        loadingIntent = historyLoaderStore.beginConversationLoadingIntent(request.conversationId, {
          initialConversation,
        });
      };

      if (plan.closeSecondaryPane && layoutStore.state.activeDocument) {
        await leaveDocumentRuntimeThen(() => {
          beginHistoryLoadingIntent();
          setWorkspaceView(request.scope);
          applyConversationLayout();
        });
      } else {
        cancelDocumentOpenIntent();
        beginHistoryLoadingIntent();
        setWorkspaceView(request.scope);
        applyConversationLayout();
      }
      const loadResult = await historyLoaderStore.loadConversation(request.conversationId, {
        initialConversation,
        loadingIntent,
      });
      /**
       * 删除或更新的导航世代可能在加载等待期间取得控制权。
       * 只有真正提交的世代才能更新持久的最近对话，否则会把已删除身份重新写回。
       */
      if (loadResult.status === 'committed') {
        workspaceScopeStore.rememberLastActiveConversation(request.scope, request.conversationId);
      }
    },

    async openDocument(request) {
      const projectId = resolveDocumentProjectId(request);
      const documentType = resolveDocumentType(request.type);
      const documentRuntimeLoader = documentType.fileSessionType
        ? null
        : getRequiredDocumentRuntimeLoader(documentType);
      const intent = beginDocumentOpenIntent();

      const layoutStore = useLayoutStore();
      const workspaceScopeStore = useWorkspaceScopeStore();
      const previousScope = cloneWorkspaceScope(workspaceScopeStore.currentScope);
      const scope: WorkspaceNavigationScope = { kind: 'project', projectId };
      const plan = resolveDocumentNavigationPlan(
        layoutStore.state,
        areWorkspaceScopesEqual(previousScope, scope),
      );
      setWorkspaceView(scope);

      const document: ActiveDocument = {
        id: request.documentId,
        projectId,
        type: toActiveDocumentType(request.type),
      };
      const applyDocumentLayout = () => {
        if (plan.placement === 'right-pane') {
          layoutStore.openDocumentInRightPane(document);
          return;
        }

        if (plan.closeSecondaryPane) {
          useAssistantStore().clearActiveConversation();
          layoutStore.openDocumentInMainPaneWithoutSecondary(document);
          return;
        }

        layoutStore.replaceDocumentInMainPane(document);
      };

      if (!documentType.fileSessionType) {
        await saveCurrentSessionBeforeReplacingSurface(null);
        if (!isCurrentDocumentOpenIntent(intent)) return;
      } else {
        const fileManagerType = getRequiredFileSessionType(documentType);
        await saveCurrentSessionBeforeReplacingSurface({
          documentId: request.documentId,
          type: fileManagerType,
        });
        if (!isCurrentDocumentOpenIntent(intent)) return;
      }

      if (plan.placement === 'right-pane') {
        if (!documentType.deferSurfaceUntilOpen) {
          applyDocumentLayout();
        }
      } else {
        if (!documentType.deferSurfaceUntilOpen) {
          applyDocumentLayout();
        }
      }

      if (!documentType.fileSessionType) {
        const runtimeLoader = documentRuntimeLoader;
        if (!runtimeLoader) {
          throw new Error(`[workspaceNavigation] ${documentType.activeDocumentType} is not registered for runtime loading`);
        }
        await nextTick();
        const isReadyForIntent = await waitForDocumentSurfaceIntent(intent, document);
        if (!isReadyForIntent) return;
        useFileStore().setFilePath(request.documentId, request.displayName ?? null);
        await nextTick();
        const runtimeLoadRequest: DocumentRuntimeLoadRequest = {
          documentId: request.documentId,
          projectId,
          displayName: request.displayName ?? null,
          parentId: request.parentId ?? null,
          ...(request.parameters ? { parameters: request.parameters } : {}),
        };
        await runtimeLoader.load(runtimeLoadRequest);
        return;
      }

      const fileManagerType = getRequiredFileSessionType(documentType);
      const activeSession = getActiveFileSession();
      if (activeSession?.documentId === request.documentId && activeSession.type === fileManagerType) {
        if (documentType.deferSurfaceUntilOpen) {
          applyDocumentLayout();
        }
        return;
      }

      if (documentType.deferSurfaceUntilOpen) {
        // 中文说明：部分文档 surface 依赖 handler.open 写入的 pending open context。
        // 对这类文档，先挂载 surface 会读到旧 fileStore.currentFilePath，使插件运行时
        // 绑定错误的文档 ID；因此必须先激活文件会话，再挂载 surface。
        await activateFileSession({
          documentId: request.documentId,
          displayName: request.displayName ?? null,
          type: fileManagerType,
          openSignal: intent.controller.signal,
          payload: {
            projectId,
            parentId: request.parentId ?? null,
            surfacePlacement: plan.placement,
          },
        });
        if (!isCurrentDocumentOpenIntent(intent)) return;
        applyDocumentLayout();
        await nextTick();
        await waitForDocumentSurfaceIntent(intent, document);
        return;
      }

      await nextTick();
      const isReadyForIntent = await waitForDocumentSurfaceIntent(intent, document);
      if (!isReadyForIntent) return;
      await activateFileSession({
        documentId: request.documentId,
        displayName: request.displayName ?? null,
        type: fileManagerType,
        openSignal: intent.controller.signal,
        payload: {
          projectId,
          parentId: request.parentId ?? null,
          surfacePlacement: plan.placement,
        },
      });
    },

  };
}
