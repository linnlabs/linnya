// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { readDocument } = vi.hoisted(() => {
  // 生产 extension registry 里的 IPC gateway 在加载时要求 preload API 存在。
  Object.assign(window, { electronAPI: {} });
  return { readDocument: vi.fn() };
});
vi.mock('../../../../../shared/ipc/workspaceGateway', () => ({
  workspaceGateway: { 'read-document': readDocument },
}));
// Editor 的 Markdown 解析服务与导出无关；生产 extension registry 构造时会引用它。
vi.mock('../../../../../shared/services/markdownService', () => ({
  parseMarkdown: vi.fn(),
  parseMarkdownToBlocksByStreaming: vi.fn(),
}));

import type { WorkspaceNode } from '../../../definitions/workspaceTree';
import { describeBatchExportResult } from '../../../functions/describeBatchExportResult';
import { batchExportProjectAsMarkdown, type BatchExportResult } from './batchExportService';

function node(id: string, name: string, type: string, children?: WorkspaceNode[]): WorkspaceNode {
  return {
    id, name, type, projectId: 'project', parentId: null, isExpanded: false, depth: 0,
    ...(children ? { children } : {}),
  };
}

function paragraphDocument(text: string): unknown {
  return {
    type: 'doc',
    content: [{
      type: 'rootBlock',
      attrs: { id: `root-${text}` },
      content: [{ type: 'baseBlock', attrs: { id: `base-${text}` }, content: [{ type: 'text', text }] }],
    }],
  };
}

const exportFiles = vi.fn();
const workspaceMessage = (key: string, params?: Record<string, unknown>) => {
  if (key === 'workspace.sidebar.fileTree.batchExportNameSeparator') return '、';
  return params ? `${key} ${JSON.stringify(params)}` : key;
};

beforeEach(() => {
  setActivePinia(createPinia());
  readDocument.mockReset();
  exportFiles.mockReset();
  exportFiles.mockImplementation(async ({ files }: { files: Array<{ fileName: string }> }) => ({
    success: true,
    data: { writtenPaths: files.map(file => `/export/${file.fileName}`) },
  }));
  vi.stubGlobal('electronAPI', {
    openDirectoryDialog: async () => ({ success: true, data: { canceled: false, filePaths: ['/export'] } }),
    exportFilesToDirectory: exportFiles,
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('批量导出逐篇处理', () => {
  // 首次导出会加载正式编辑器 schema，CI 上也要覆盖这条冷路径。
  it('坏文档列为失败、其余全部写出；没有打开任何文档也能导出；插件文档只计数', async () => {
    const tree = [
      node('normal', '正常', 'document'),
      node('unreadable', '正文损坏', 'document'),
      node('folder', '资料', 'folder', [
        node('invalid', '结构不合法', 'document'),
        node('nested', '子文档', 'document'),
      ]),
      node('missing-image', '缺图', 'document'),
      node('slides', '演示', 'slides'),
    ];
    readDocument.mockImplementation(async ({ documentId }: { documentId: string }) => {
      if (documentId === 'unreadable') {
        return { success: false, error: '这篇文档的正文已损坏，无法读取（Unexpected end of JSON input）' };
      }
      if (documentId === 'invalid') {
        // 后端放行了也要在这里拦住：结构不合法的文档不能写出半篇。
        return { success: true, data: { content: { type: 'doc', content: [{ type: 'paragraph' }] }, pendingRevisions: [] } };
      }
      if (documentId === 'missing-image') {
        return {
          success: true,
          data: {
            content: {
              type: 'doc',
              content: [{
                type: 'rootBlock',
                attrs: { id: 'root-image' },
                content: [{ type: 'imageBlock', attrs: { id: 'image', src: 'media://load/doc-image/missing.png' } }],
              }],
            },
            pendingRevisions: [],
          },
        };
      }
      return { success: true, data: { content: paragraphDocument(`${documentId} 正文`), pendingRevisions: [] } };
    });

    const result = await batchExportProjectAsMarkdown({
      treeStore: { projectTree: tree, findNodeById: () => null, loadNodeChildren: async () => undefined },
      settings: {},
      workspaceMessage,
    });

    expect(result).toEqual({
      success: true,
      exportedCount: 3,
      failedDocumentNames: ['正文损坏', '结构不合法'],
      skippedPluginDocumentCount: 1,
    });
    expect(exportFiles).toHaveBeenCalledOnce();
    const files: Array<{ fileName: string; content: string }> = exportFiles.mock.calls[0][0].files;
    expect(files.map(file => file.fileName)).toEqual(['正常.md', '子文档.md', '缺图.md']);
    expect(files[0]?.content).toContain('normal 正文');
    // 缺图不影响导出：图片按现有规则写成块引用。
    expect(files[2]?.content).toContain('linnya-image://image');
  }, 30_000);

  it('全部失败时不写任何文件，如实报告 0 篇', async () => {
    readDocument.mockResolvedValue({ success: false, error: 'broken' });
    const result = await batchExportProjectAsMarkdown({
      treeStore: { projectTree: [node('a', 'A', 'document')], findNodeById: () => null, loadNodeChildren: async () => undefined },
      settings: {},
      workspaceMessage,
    });
    expect(result).toEqual({
      success: true, exportedCount: 0, failedDocumentNames: ['A'], skippedPluginDocumentCount: 0,
    });
    expect(exportFiles).not.toHaveBeenCalled();
  });
});

describe('批量导出结果提示', () => {
  const success = (overrides: Partial<Extract<BatchExportResult, { success: true }>>) => ({
    success: true as const, exportedCount: 3, failedDocumentNames: [], skippedPluginDocumentCount: 0, ...overrides,
  });

  it('全部成功：成功提示；有插件文档时说明不在范围内', () => {
    expect(describeBatchExportResult(success({}), workspaceMessage)).toEqual({
      message: 'workspace.sidebar.fileTree.batchExportComplete {"count":3}',
      type: 'success',
      durationMs: 3000,
    });
    expect(describeBatchExportResult(success({ skippedPluginDocumentCount: 2 }), workspaceMessage).message)
      .toBe('workspace.sidebar.fileTree.batchExportComplete {"count":3} workspace.sidebar.fileTree.batchExportPluginDocumentsSkipped {"count":2}');
  });

  it('部分失败：列出失败文档名，超过 5 篇用省略号', () => {
    const notice = describeBatchExportResult(
      success({ failedDocumentNames: ['一', '二', '三', '四', '五', '六'] }),
      workspaceMessage,
    );
    expect(notice.type).toBe('warning');
    expect(notice.message).toBe(
      'workspace.sidebar.fileTree.batchExportPartial {"count":3,"failedCount":6,"names":"一、二、三、四、五…"}',
    );
  });
});
