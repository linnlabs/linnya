/**
 * @file batchExportService.ts
 * @description 工作区批量导出服务（目前仅支持 Markdown 文档）
 *
 * 设计说明（中文）：
 * - 导出源：当前项目下的所有 Markdown 文档（type === 'document'）
 * - 导出目标：用户在系统对话框中选择的“本地目录”
 * - 仅导出 type === 'document' 的 platform Markdown 节点；插件文档由各自的导出能力负责，结果里只报份数
 * - 逐篇处理：某篇读取或解析失败时记下文档名继续下一篇，写出全部成功的文档；不另写结果清单文件
 * - 正文由 Editor 域按打开文档时的同一 schema 严格解析，不取自活动编辑器：没有打开任何文档时也能导出
 * - 文件名重名处理：同一批次/目标目录内如果冲突，按 `name(1).md`、`name(2).md` 递增
 */

import { workspaceGateway } from '../../../../../shared/ipc/workspaceGateway';
import { createMarkdownSerializer, type MarkdownExportSettings } from '../../../../../shared/utils/markdownSerializer';
import type { MessageParams } from '@app/localization';
import type { WorkspaceMessageKey, WorkspaceMessageResolver } from '../../../definitions/workspaceMessages';
import { buildWorkspaceMarkdownSerializerLabels } from '../../../functions/markdownSerializerLabels';
import type { WorkspaceNode } from '../../../store/WorkspaceTreeStore';
import { parseMarkdownDocumentForExport } from '../../../../editor/document-export';

type TreeStoreLike = {
  findNodeById: (nodeId: string) => WorkspaceNode | null;
  loadNodeChildren: (node: WorkspaceNode) => Promise<void>;
  projectTree: WorkspaceNode[];
};

type BatchExportFailure = {
  readonly key: Extract<
    WorkspaceMessageKey,
    | 'workspace.export.batch.apiUnavailable'
    | 'workspace.export.batch.noDocuments'
    | 'workspace.export.batch.openDirectoryFailed'
    | 'workspace.export.batch.directorySelectionCanceled'
    | 'workspace.export.batch.writeFailed'
  >;
  readonly params?: MessageParams;
};

export type BatchExportResult =
  | {
      readonly success: true;
      readonly exportedCount: number;
      /** 读取或解析失败、没有写出的文档名，按目录顺序。 */
      readonly failedDocumentNames: readonly string[];
      /** 不在 Markdown 导出范围内的插件文档份数。 */
      readonly skippedPluginDocumentCount: number;
    }
  | { readonly success: false; readonly error: BatchExportFailure };

function sanitizeFileBaseName(input: string): string {
  // 中文说明：Windows/macOS 通用非法字符过滤；同时规避结尾的点/空格
  const trimmed = input.trim();
  const replaced = trimmed.replace(/[\\/:*?"<>|]/g, '_');
  const noTrailing = replaced.replace(/[.\s]+$/g, '');
  return noTrailing.length > 0 ? noTrailing : 'Untitled';
}

function withMdExtension(baseName: string): string {
  const clean = baseName.replace(/\.[^/.]+$/u, '');
  return `${clean}.md`;
}

function buildUniqueNames(fileBaseNames: string[]): string[] {
  // 中文说明：仅处理“本批次内”重名；磁盘冲突由主进程再次兜底处理
  const used = new Map<string, number>();
  const result: string[] = [];

  for (const base of fileBaseNames) {
    const key = base.toLowerCase();
    const current = used.get(key) ?? 0;
    if (current === 0) {
      used.set(key, 1);
      result.push(base);
      continue;
    }

    // 已存在：追加 (n)
    const ext = '.md';
    const stem = base.endsWith(ext) ? base.slice(0, -ext.length) : base;
    const next = `${stem}(${current})${ext}`;
    used.set(key, current + 1);
    result.push(next);
  }

  return result;
}

async function collectDocumentsRecursively(params: {
  treeStore: TreeStoreLike;
  startNodes: WorkspaceNode[];
}): Promise<{ readonly documents: WorkspaceNode[]; readonly pluginDocumentCount: number }> {
  const { treeStore, startNodes } = params;
  const docs: WorkspaceNode[] = [];
  let pluginDocumentCount = 0;

  const walk = async (node: WorkspaceNode): Promise<void> => {
    if (node.type === 'document') {
      docs.push(node);
      return;
    }
    // 中文说明：目前树节点类型里 folder 才有 children；其他文档类型是插件文档，只计数
    if (node.type !== 'folder') {
      if (!node.isVirtual) pluginDocumentCount += 1;
      return;
    }

    if (node.children === null) {
      await treeStore.loadNodeChildren(node);
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      await walk(child);
    }
  };

  for (const n of startNodes) {
    await walk(n);
  }
  return { documents: docs, pluginDocumentCount };
}

export async function batchExportProjectAsMarkdown(params: {
  treeStore: TreeStoreLike;
  settings: MarkdownExportSettings;
  workspaceMessage: WorkspaceMessageResolver;
}): Promise<BatchExportResult> {
  const { treeStore, settings, workspaceMessage } = params;

  const electronAPI = window.electronAPI;
  if (typeof electronAPI?.openDirectoryDialog !== 'function' || typeof electronAPI?.exportFilesToDirectory !== 'function') {
    return { success: false, error: { key: 'workspace.export.batch.apiUnavailable' } };
  }

  // 1) 递归收集当前项目所有 platform document 节点（插件文档只计数）
  const { documents: documentNodes, pluginDocumentCount } = await collectDocumentsRecursively({
    treeStore,
    startNodes: treeStore.projectTree,
  });
  if (documentNodes.length === 0) {
    return { success: false, error: { key: 'workspace.export.batch.noDocuments' } };
  }

  // 2) 选择导出目录
  const dirResult = await electronAPI.openDirectoryDialog({
    title: workspaceMessage('workspace.export.batch.chooseDirectory'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (!dirResult.success) {
    return { success: false, error: { key: 'workspace.export.batch.openDirectoryFailed' } };
  }
  const chosen = dirResult.data;
  if (!chosen || chosen.canceled || !Array.isArray(chosen.filePaths) || chosen.filePaths.length === 0) {
    return { success: false, error: { key: 'workspace.export.batch.directorySelectionCanceled' } };
  }
  const directoryPath = chosen.filePaths[0];

  // 3) 读取每篇文档内容并序列化为 Markdown
  const serializer = createMarkdownSerializer({
    ...settings,
    labels: buildWorkspaceMarkdownSerializerLabels(workspaceMessage),
  });
  const baseNames = documentNodes.map((n) => withMdExtension(sanitizeFileBaseName(n.name)));
  const uniqueNames = buildUniqueNames(baseNames);

  const files: Array<{ fileName: string; content: string }> = [];
  const failedDocumentNames: string[] = [];
  for (let i = 0; i < documentNodes.length; i += 1) {
    const node = documentNodes[i];
    const fileName = uniqueNames[i];

    try {
      const readResult = await workspaceGateway['read-document']({ documentId: node.id });
      if (!readResult.success) throw new Error(readResult.error);
      const pmDoc = await parseMarkdownDocumentForExport(readResult.data.content);
      files.push({ fileName, content: serializer.serialize(pmDoc) });
    } catch (error: unknown) {
      // 一篇读不出或解析失败只跳过这一篇，其余照常导出。
      console.error('[BatchExportService] 导出文档失败:', {
        documentId: node.id,
        documentName: node.name,
        error: error instanceof Error ? error.message : String(error),
      });
      failedDocumentNames.push(node.name);
    }
  }

  // 4) 主进程批量写文件（主进程侧会二次处理“磁盘已存在”的重名）
  let exportedCount = 0;
  if (files.length > 0) {
    const exportResult = await electronAPI.exportFilesToDirectory({ directoryPath, files });
    if (!exportResult.success) {
      return { success: false, error: { key: 'workspace.export.batch.writeFailed' } };
    }
    exportedCount = exportResult.data?.writtenPaths?.length ?? files.length;
  }

  return {
    success: true,
    exportedCount,
    failedDocumentNames,
    skippedPluginDocumentCount: pluginDocumentCount,
  };
}
