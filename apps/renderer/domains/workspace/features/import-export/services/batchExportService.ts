/**
 * @file batchExportService.ts
 * @description 工作区批量导出服务（目前仅支持 Markdown 文档）
 *
 * 设计说明（中文）：
 * - 导出源：当前项目下的所有 Markdown 文档（type === 'document'）
 * - 导出目标：用户在系统对话框中选择的“本地目录”
 * - 仅导出 type === 'document' 的 platform Markdown 节点；插件文档由各自的导出能力负责
 * - 文件名重名处理：同一批次/目标目录内如果冲突，按 `name(1).md`、`name(2).md` 递增
 */

import { workspaceGateway } from '../../../../../shared/ipc/workspaceGateway';
import { createMarkdownSerializer, type MarkdownExportSettings } from '../../../../../shared/utils/markdownSerializer';
import type { MessageParams } from '@app/localization';
import type { UserFacingMessage } from '@app/schemas';
import type { WorkspaceMessageKey, WorkspaceMessageResolver } from '../../../definitions/workspaceMessages';
import { buildWorkspaceMarkdownSerializerLabels } from '../../../functions/markdownSerializerLabels';
import type { WorkspaceNode } from '../../../store/WorkspaceTreeStore';
import { Node as ProsemirrorNode } from 'prosemirror-model';
import type { Schema } from 'prosemirror-model';

type UIStoreLike = {
  getEditor: () => { state: { schema: Schema } } | null;
};

type TreeStoreLike = {
  findNodeById: (nodeId: string) => WorkspaceNode | null;
  loadNodeChildren: (node: WorkspaceNode) => Promise<void>;
  projectTree: WorkspaceNode[];
};

type ElectronApiLike = {
  openDirectoryDialog: (options: unknown) => Promise<{
    success: boolean;
    data?: { canceled: boolean; filePaths: string[] };
    error?: string;
    userMessage?: UserFacingMessage;
  }>;
  exportFilesToDirectory: (payload: { directoryPath: string; files: Array<{ fileName: string; content: string }> }) => Promise<{
    success: boolean;
    data?: { writtenPaths: string[] };
    error?: string;
    userMessage?: UserFacingMessage;
  }>;
};

type BatchExportFailure = {
  readonly key: Extract<
    WorkspaceMessageKey,
    | 'workspace.export.batch.apiUnavailable'
    | 'workspace.export.batch.schemaUnavailable'
    | 'workspace.export.batch.noDocuments'
    | 'workspace.export.batch.openDirectoryFailed'
    | 'workspace.export.batch.directorySelectionCanceled'
    | 'workspace.export.batch.readDocumentFailed'
    | 'workspace.export.batch.writeFailed'
  >;
  readonly params?: MessageParams;
};

type BatchExportResult =
  | { readonly success: true; readonly exportedCount: number }
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
}): Promise<WorkspaceNode[]> {
  const { treeStore, startNodes } = params;
  const docs: WorkspaceNode[] = [];

  const walk = async (node: WorkspaceNode): Promise<void> => {
    if (node.type === 'document') {
      docs.push(node);
      return;
    }
    // 中文说明：目前树节点类型里 folder 才有 children；其他文档类型直接跳过
    if (node.type !== 'folder') {
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
  return docs;
}

export async function batchExportProjectAsMarkdown(params: {
  treeStore: TreeStoreLike;
  uiStore: UIStoreLike;
  settings: MarkdownExportSettings;
  workspaceMessage: WorkspaceMessageResolver;
}): Promise<BatchExportResult> {
  const { treeStore, uiStore, settings, workspaceMessage } = params;

  const electronAPI = window.electronAPI;
  if (typeof electronAPI?.openDirectoryDialog !== 'function' || typeof electronAPI?.exportFilesToDirectory !== 'function') {
    return { success: false, error: { key: 'workspace.export.batch.apiUnavailable' } };
  }

  const editor = uiStore.getEditor();
  if (!editor) {
    return { success: false, error: { key: 'workspace.export.batch.schemaUnavailable' } };
  }

  // 1) 递归收集当前项目所有 platform document 节点（插件文档自动跳过）
  const documentNodes = await collectDocumentsRecursively({ treeStore, startNodes: treeStore.projectTree });
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
  const schema = editor.state.schema;

  const baseNames = documentNodes.map((n) => withMdExtension(sanitizeFileBaseName(n.name)));
  const uniqueNames = buildUniqueNames(baseNames);

  const files: Array<{ fileName: string; content: string }> = [];
  for (let i = 0; i < documentNodes.length; i += 1) {
    const node = documentNodes[i];
    const fileName = uniqueNames[i];

    const readResult = await workspaceGateway['read-document']({ documentId: node.id });
    if (!readResult.success) {
      console.error('[BatchExportService] 读取文档失败:', {
        documentId: node.id,
        documentName: node.name,
        error: readResult.error,
      });
      return {
        success: false,
        error: {
          key: 'workspace.export.batch.readDocumentFailed',
          params: { documentName: node.name },
        },
      };
    }

    const contentJson = readResult.data.content;
    // 中文说明：使用“当前编辑器的 schema”解析其他文档 JSON，避免重复构建 schema（保持一致性）
    const pmDoc = ProsemirrorNode.fromJSON(schema, contentJson);
    const markdown = serializer.serialize(pmDoc);

    files.push({ fileName, content: markdown });
  }

  // 4) 主进程批量写文件（主进程侧会二次处理“磁盘已存在”的重名）
  const exportResult = await electronAPI.exportFilesToDirectory({ directoryPath, files });
  if (!exportResult.success) {
    return { success: false, error: { key: 'workspace.export.batch.writeFailed' } };
  }

  const exportedCount = exportResult.data?.writtenPaths?.length ?? files.length;
  return { success: true, exportedCount };
}
