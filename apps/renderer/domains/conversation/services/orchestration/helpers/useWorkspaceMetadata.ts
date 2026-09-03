/**
 * @file apps/renderer/domains/conversation/services/orchestration/helpers/useWorkspaceMetadata.ts
 * @description 工作区元数据组装 composable
 *
 * Phase 1 解耦：
 * - 把 projectId / projectMetadata / documentMetadata / projectFileList 的组装逻辑统一收口
 * - 让各 orchestrator（chat/task/...）复用同一份代码，避免逻辑泄漏和重复
 */

import { useAssistantStore } from '../../../store/assistantStore';
import { useFileStore } from '../../../../../shared/stores/file';
import { useConversationState } from '../../../store/conversationState';
import { useWorkspaceScopeStore } from '../../../../../shared/stores/workspaceScopeStore';
import { getWorkspaceContextPort } from '../../../../../shared/ports/workspaceContextPort';
import { resolveConversationProjectId } from '../../../functions/resolveConversationProjectId';
import type { ProjectFileSummary, SendMessageOptions } from '../../../types';

function readOptionalString(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const rec = obj as Record<string, unknown>;
  const v = rec[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * 工作区元数据结果
 */
export interface WorkspaceMetadataPayload {
  projectId?: string;
  projectMetadata?: SendMessageOptions['projectMetadata'];
  documentMetadata?: SendMessageOptions['documentMetadata'];
  projectFileList?: ProjectFileSummary[];
}

/**
 * 工作区元数据组装 composable
 *
 * 中文备注：
 * - 把各 orchestrator 中重复的 metadata 组装逻辑统一收口
 * - 各 orchestrator 只需调用 buildWorkspaceMetadata() 获取统一的 payload
 */
export function useWorkspaceMetadata() {
  const assistantStore = useAssistantStore();
  const workspaceScopeStore = useWorkspaceScopeStore();
  const fileStore = useFileStore();
  const conversationState = useConversationState();

  /**
   * 构建工作区元数据 payload
   *
   * 中文备注：
   * - projectId：优先使用 scope，其次回退到会话 metadata
   * - projectMetadata：项目的人类可读信息
   * - documentMetadata：当前文档的人类可读信息
   * - projectFileList：当前项目下的文件概要列表（用于 Agent 上下文引导）
   */
  const buildWorkspaceMetadata = (): WorkspaceMetadataPayload => {
    const conversationMeta = assistantStore.activeConversation?.metadata;
    const workspaceContext = getWorkspaceContextPort();
    const activeSession = workspaceContext.getActiveDocumentSession();
    const filePath = fileStore.currentFilePath;

    /**
     * ✅ 对齐 chatFlowOrchestrator 口径：documentId/title 允许从会话 metadata 回退
     *
     * 中文备注：
      * - 多种入口在“历史回放/非 editor 视图”下，store 的 currentDocumentId 可能为空；
     * - 但会话 metadata 里可能仍携带 documentId/documentTitle（历史回放会带）；
     * - 因此这里把会话 metadata 的回退逻辑纳入统一 helper。
     */
    const conversationDocumentId =
      readOptionalString(conversationMeta, 'documentId') ?? readOptionalString(conversationMeta, 'document_id');
    const conversationDocumentTitle =
      readOptionalString(conversationMeta, 'documentTitle') ?? readOptionalString(conversationMeta, 'document_title');

    // 1. 构建 documentMetadata（UI 当前文档优先，其次回退 fileStore，再回退会话 metadata）
    const documentId =
      activeSession?.documentId ??
      (typeof filePath === 'string' && filePath.length > 0 ? filePath : null) ??
      conversationDocumentId ??
      undefined;
    const documentSummary = documentId ? workspaceContext.findDocumentSummary(documentId) : null;
    const documentTitle = (() => {
      if (!documentSummary) {
        return activeSession?.displayName ?? fileStore.currentFileName ?? conversationDocumentTitle ?? undefined;
      }
      if (documentSummary.title && documentSummary.title.length > 0) return documentSummary.title;
      return fileStore.currentFileName ?? conversationDocumentTitle ?? undefined;
    })();
    const documentMetadata = documentId
      ? {
          id: documentId,
          title: documentTitle,
        }
      : undefined;

    /**
     * ✅ 对齐 chatFlowOrchestrator 口径：允许从 documentNode.projectId 回退 projectId
     *
     * 中文备注：
     * - 某些场景 scopeProjectId 为空，但当前文档节点带 projectId；
     * - 仅依赖 resolveConversationProjectId 会错过这个信息；
     * - 因此这里把 documentNode.projectId 纳入 projectId 的回退链路。
     */
    const documentNodeProjectId = documentSummary?.projectId;

    // 2. 解析 projectId
    // 中文说明：Linnya 助手是明确的无项目 scope，不能再从 activeProjectId 偷偷回退，
    // 否则“上次项目”会污染助手对话的落库归属和上下文。
    const scope = workspaceScopeStore.currentScope;
    const resolvedProjectId = scope.kind === 'project'
      ? (
          resolveConversationProjectId(scope.projectId, conversationMeta) ??
          documentNodeProjectId ??
          undefined
        )
      : undefined;

    // 2. 构建 projectMetadata
    const conversationProjectName =
      readOptionalString(conversationMeta, 'projectName') ?? readOptionalString(conversationMeta, 'project_name');
    const conversationProjectDescription =
      readOptionalString(conversationMeta, 'projectDescription') ??
      readOptionalString(conversationMeta, 'project_description');
    const project = resolvedProjectId
      ? workspaceContext.getCurrentProjectSummary(resolvedProjectId)
      : null;
    const projectMetadata = project
      ? {
          id: resolvedProjectId ?? project.id,
          name: project.name ?? conversationProjectName,
          // 统一把 null 归一化为 undefined（schema 不接受 null）
          description: (project.description ?? conversationProjectDescription) ?? undefined,
        }
      : resolvedProjectId
        ? { id: resolvedProjectId, name: conversationProjectName, description: conversationProjectDescription ?? undefined }
        : undefined;

    // 4. 构建 projectFileList（轻量概要，只用于 Agent 上下文引导）
    const projectFileList = (() => {
      if (!resolvedProjectId) return undefined;
      const summaries: ProjectFileSummary[] = workspaceContext.getProjectFileSummaries(resolvedProjectId, {
        limit: 10,
      });
      return summaries.length > 0 ? summaries : undefined;
    })();

    return { projectId: resolvedProjectId, projectMetadata, documentMetadata, projectFileList };
  };

  /**
   * 同步会话元数据到 conversationState
   *
   * 中文备注：
   * - 在发送消息前调用，确保 UI/历史面板能显示正确的项目/文档信息
   */
  const syncMetadataToConversation = (
    conversationId: string,
    payload: WorkspaceMetadataPayload
  ): void => {
    const { projectId, projectMetadata, documentMetadata } = payload;
    if (projectMetadata || documentMetadata) {
      assistantStore.mergeConversationMetadata(conversationId, {
        projectId: projectMetadata?.id ?? projectId,
        projectName: projectMetadata?.name,
        projectDescription: projectMetadata?.description,
        documentId: documentMetadata?.id,
        documentTitle: documentMetadata?.title,
      });
    }
  };

  return {
    buildWorkspaceMetadata,
    syncMetadataToConversation,
    assistantStore,
    conversationState,
  };
}
