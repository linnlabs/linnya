/**
 * @file 页面上下文构建器
 *
 * 中文说明：
 * - 统一产出"当前页面上下文"（页面类型/文档/选中节点/选中文本等）
 * - 作为 Agent 请求的一等公民注入
 * - 唯一入口，避免散落在各 orchestrator 里重复实现
 *
 * 插件页面通过 RendererPageContextProvider 参与，Host 不依赖具体插件。
 */

import { useFileStore } from '../../../../../shared/stores/file';
import { getWorkspaceContextPort } from '../../../../../shared/ports/workspaceContextPort';
import {
  getRendererPageContextProviderByDocumentType,
  type RendererPageContextSummary,
} from '@plugin/renderer/pageContextProvider';
import { getDocumentTypeByCreateRequestType } from '@/app/plugins/registry';

// =========================================================================
// 类型定义
// =========================================================================

// 中文说明：kind 来自 renderer document type registry 的 activeDocumentType。
// 除 project_home 等非文档页面外，不再在 conversation 里维护封闭枚举。
export type PageKind = string;

/**
 * 文档信息
 */
export interface PageContextDocument {
  id: string;
  type: string;
  title?: string;
}

/**
 * 选区信息
 */
export interface PageContextSelection {
  /** Editor：选中文本 */
  selectedText?: string;
  /** 节点型文档可选的选中实体 ID 列表（业务 ID，不是 DOM ID）。 */
  selectedNodeIds?: string[];
  /** 画布型文档可选的选中元素 ID 列表。 */
  selectedElementIds?: string[];
}

/**
 * 页面上下文 V1
 *
 * 中文说明：
 * - 最小可用版本：先保证 kind + document.id/type 可用
 * - 跨层不泄漏 DOM：selection 只使用插件公开的业务 ID
 */
export interface PageContextV1 {
  kind: PageKind;
  projectId?: string;
  document?: PageContextDocument;
  selection?: PageContextSelection;
  pluginSummary?: RendererPageContextSummary;
}

/**
 * 将 pageContext 序列化为“可注入到 context_before”的短文本
 *
 * 中文说明：
 * - 目的：让 Agent 在本轮请求中显式知道“当前处于哪个页面/打开哪个文档/选中了什么”
 * - 约束：短小、稳定、可 debug；不要塞大量内容（大内容放在 document_fragment）
 */
export function formatPageContextForContextBefore(pageContext: PageContextV1): string {
  const lines: string[] = [];
  lines.push('[page_context]');

  if (pageContext.projectId) {
    lines.push(`project_id=${pageContext.projectId}`);
  }

  if (pageContext.document?.id) {
    lines.push(`document_id=${pageContext.document.id}`);
    if (pageContext.document.type) {
      lines.push(`document_type=${pageContext.document.type}`);
    }
    if (pageContext.document.title) {
      lines.push(`document_title=${pageContext.document.title}`);
    }
  } else {
    // 中文说明：kind 是 UI 场景，不是文档身份；只有没有打开文档时才暴露给 Agent。
    lines.push(`kind=${pageContext.kind}`);
  }

  const selectedNodeIds = pageContext.selection?.selectedNodeIds;
  if (Array.isArray(selectedNodeIds) && selectedNodeIds.length > 0) {
    lines.push(`selected_node_ids=${JSON.stringify(selectedNodeIds)}`);
  }

  const selectedElementIds = pageContext.selection?.selectedElementIds;
  if (Array.isArray(selectedElementIds) && selectedElementIds.length > 0) {
    lines.push(`selected_element_ids=${JSON.stringify(selectedElementIds)}`);
  }

  const selectedText = pageContext.selection?.selectedText;
  if (selectedText && selectedText.trim().length > 0) {
    // 中文说明：选中文本可能很长，这里做截断，避免挤占上下文预算
    const trimmed = selectedText.trim();
    const clipped = trimmed.length > 200 ? `${trimmed.slice(0, 200)}…(clipped)` : trimmed;
    lines.push(`selected_text=${JSON.stringify(clipped)}`);
  }

  const pluginSummary = pageContext.pluginSummary;
  if (pluginSummary) {
    for (const section of pluginSummary.sections) {
      if (!section.sectionName.trim() || section.lines.length === 0) continue;
      lines.push(`[${section.sectionName}]`);
      for (const line of section.lines) {
        lines.push(line);
      }
    }
  }

  return lines.join('\n');
}

// =========================================================================
// 构建函数
// =========================================================================

function mapDocumentToPageKind(document: PageContextDocument | undefined): PageKind | null {
  if (!document?.type || document.type === 'unknown') return null;
  const documentType = getDocumentTypeByCreateRequestType(document.type);
  return documentType?.activeDocumentType ?? null;
}

function mapWorkspaceDocumentType(type: string | undefined): string {
  return type?.trim() || 'unknown';
}

/**
 * 构建文档信息
 *
 * 中文说明：
 * - 优先从 file-manager 的 activeSession 获取（权威来源）；
 * - 其次从 fileStore/treeStore 回退；
 * - 不在“无 active 文档”时遍历插件 provider。provider 只补充当前文档的选区/摘要，
 *   不能把已禁用或已关闭插件 store 中的残留文档伪装成当前页面。
 */
function buildDocumentInfo(): PageContextDocument | undefined {
  const fileStore = useFileStore();
  const workspaceContext = getWorkspaceContextPort();

  // 1. 优先从 file-manager 的 activeSession 获取
  const session = workspaceContext.getActiveDocumentSession();
  if (session) {
    return {
      id: session.documentId,
      type: mapWorkspaceDocumentType(session.type),
      title: session.displayName ?? undefined,
    };
  }

  // 2. 从 fileStore 回退
  const documentId = fileStore.currentFilePath;
  if (!documentId) {
    return undefined;
  }

  const documentSummary = workspaceContext.findDocumentSummary(documentId);
  const docType = mapWorkspaceDocumentType(documentSummary?.type);

  const title = documentSummary?.title ? documentSummary.title : fileStore.currentFileName ?? undefined;

  return {
    id: documentId,
    type: docType,
    title,
  };
}

/**
 * 构建页面上下文 V1
 *
 * 中文说明：
 * - 这是外部唯一的构建入口
 * - 收敛所有上下文来源，避免散落
 *
 * @returns PageContextV1
 */
export function buildPageContextV1(): PageContextV1 {
  // 1. 文档信息
  const document = buildDocumentInfo();
  const documentProvider = getRendererPageContextProviderByDocumentType(document?.type);

  // 2. 页面类型
  // 中文说明：页面上下文只读取真实文档 runtime/fileStore，不再从 UI 视图枚举推断业务状态。
  const kind = mapDocumentToPageKind(document) ?? 'project_home';

  // 3. 插件文档选区由对应 provider 提供，conversation 不直接读取插件 store。
  const selection = documentProvider?.buildSelection?.();
  const pluginSummary = documentProvider?.buildSummary?.();

  // 4. 项目 ID（可选，从文档节点获取）
  const projectId = (() => {
    if (!document) return undefined;
    return getWorkspaceContextPort().findDocumentSummary(document.id)?.projectId;
  })();

  return {
    kind,
    projectId,
    document,
    selection,
    pluginSummary,
  };
}

// =========================================================================
// 调试工具
// =========================================================================

/**
 * 日志前缀
 */
const LOG_PREFIX = '[PageContext]' as const;

/**
 * 是否启用调试日志
 */
function isDebugEnabled(): boolean {
  return (
    (window as { __PAGE_CONTEXT_DEBUG__?: boolean }).__PAGE_CONTEXT_DEBUG__ === true
  );
}

/**
 * 构建页面上下文并输出调试日志
 */
export function buildPageContextV1WithLog(): PageContextV1 {
  const context = buildPageContextV1();

  if (isDebugEnabled()) {
    console.log(`${LOG_PREFIX} built:`, {
      kind: context.kind,
      documentId: context.document?.id,
      documentType: context.document?.type,
      selectedNodeIds: context.selection?.selectedNodeIds,
      pluginSummarySections: context.pluginSummary?.sections.map(section => section.sectionName),
    });
  }

  return context;
}
