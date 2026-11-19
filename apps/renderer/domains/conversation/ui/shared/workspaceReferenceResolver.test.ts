import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDocumentReferenceRuntimeHandlersForTest,
  type DocumentReferenceFocusResult,
  registerDocumentReferenceRuntimeHandler,
} from '@plugin/renderer/documentReferenceRuntimePort';
import { registerWorkspaceReferenceContentPort } from '../../../../shared/ports/workspaceReferenceContentPort';
import { generateRefId } from '../../../../shared/utils/refIdGenerator';
import {
  parseWorkspaceRefId,
  findCurrentPluginReferenceDocument,
  getPluginReferenceLabel,
  isResolvedMarkdownReference,
  readWorkspaceDocumentCandidate,
  readWorkspaceDocumentCandidatesFromTurn,
  resolveMarkdownReferenceInDocument,
  resolvePluginReferenceInDocument,
  resolveReferenceMatches,
} from './workspaceReferenceResolver';
import type { ConversationMessageResolver } from '../../definitions/conversationMessages';
import { createTestToolMessage } from '../../testing/functions/createConversationTestMessage';

const conversationMessage: ConversationMessageResolver = (key) => {
  if (key === 'conversation.tool.workspace.reference.documentLabel') return 'Document reference';
  return key;
};

describe('workspaceReferenceResolver', () => {
  const getMarkdownRootBlockIds = vi.fn(async (): Promise<string[]> => []);

  beforeEach(() => {
    clearDocumentReferenceRuntimeHandlersForTest();
    getMarkdownRootBlockIds.mockReset();
    registerWorkspaceReferenceContentPort({
      getMarkdownRootBlockIds,
    });
  });

  it('只从 canonical read_file 结构化结果接纳文档候选', () => {
    const result = {
      data: {
        source: 'workspace_document',
        path: '/Architecture.md',
        inode: 'workspace:doc-1',
        content_type: 'application/vnd.linnya.document-view',
        document: {
          documentId: 'doc-1',
          docType: 'markdown',
          documentName: 'Architecture.md',
          truncatedByChars: false,
          totalTextLength: 2,
          nextOffset: null,
          presentation: {
            kind: 'blocks',
            viewMode: 'preview',
            viewLabel: '预览',
            items: [{ id: 'block-1', ordinal: 1, text: '正文' }],
          },
        },
      },
      observation: '[#ref] 正文',
      observationPreviewMeta: {
        document_name: 'Architecture.md',
        doc_type: 'markdown',
      },
    };

    expect(readWorkspaceDocumentCandidate('read_file', result)).toEqual({
      documentId: 'doc-1',
      docType: 'markdown',
    });
    expect(readWorkspaceDocumentCandidate('another_tool', result)).toBeNull();
    expect(readWorkspaceDocumentCandidate('read_file', {
      ...result,
      data: { ...result.data, source: 'workspace_node' },
    })).toBeNull();
  });

  it('从同一轮次成功的 read_file 工具消息重建结果并接纳文档候选', () => {
    const readFileData = {
      source: 'workspace_document',
      path: '/Architecture.md',
      inode: 'workspace:doc-1',
      content_type: 'application/vnd.linnya.document-view',
      document: {
        documentId: 'doc-1',
        docType: 'markdown',
        documentName: 'Architecture.md',
        truncatedByChars: false,
        totalTextLength: 2,
        nextOffset: null,
        presentation: {
          kind: 'blocks',
          viewMode: 'preview',
          viewLabel: '预览',
          items: [{ id: 'block-1', ordinal: 1, text: '正文' }],
        },
      },
    };
    const presentation = { observationPreviewMeta: { document_name: 'Architecture.md', doc_type: 'markdown' } };
    const messages = [
      createTestToolMessage({
        id: 'read-ok',
        content: '[#ref] 正文',
        metadata: { tool_name: 'read_file', turn_id: 'turn-1', data: readFileData, presentation },
      }),
      createTestToolMessage({
        id: 'read-other-turn',
        content: '[#ref] 正文',
        metadata: { tool_name: 'read_file', turn_id: 'turn-2', data: readFileData, presentation },
      }),
      createTestToolMessage({
        id: 'read-failed',
        content: '读取失败',
        metadata: { tool_name: 'read_file', turn_id: 'turn-1', status: 'error', error: 'boom' },
      }),
      createTestToolMessage({
        id: 'other-tool',
        content: '[#ref] 正文',
        metadata: { tool_name: 'grep', turn_id: 'turn-1', data: readFileData, presentation },
      }),
    ];

    expect(readWorkspaceDocumentCandidatesFromTurn(messages, 'turn-1')).toEqual([
      { documentId: 'doc-1', docType: 'markdown' },
    ]);
    expect(readWorkspaceDocumentCandidatesFromTurn(messages, 'turn-3')).toEqual([]);
  });

  it('只有带序号的 Markdown 引用才能显示为“第N段”', () => {
    expect(isResolvedMarkdownReference({
      documentId: 'doc-1', docType: 'markdown', resolvedId: 'block_a', index: 2,
    })).toBe(true);
    expect(isResolvedMarkdownReference({
      documentId: 'doc-1', docType: 'markdown', resolvedId: 'block_a',
    })).toBe(false);
    expect(isResolvedMarkdownReference({
      documentId: 'doc-2', docType: 'sheet', resolvedId: 'node_a',
    })).toBe(false);
  });

  it('通过 workspaceReferenceContentPort 获取 Markdown 根块候选并解析 ref', async () => {
    getMarkdownRootBlockIds.mockResolvedValue(['block_a', 'block_b', 'block_c']);
    const ref = await generateRefId('block_b');

    const resolved = await resolveMarkdownReferenceInDocument('doc_ref_port', ref);

    expect(getMarkdownRootBlockIds).toHaveBeenCalledWith('doc_ref_port');
    expect(resolved).toEqual({
      documentId: 'doc_ref_port',
      docType: 'markdown',
      resolvedId: 'block_b',
      index: 2,
    });
  });

  it('通过文档引用运行时端口获取插件实体候选并解析 ref', async () => {
    const ref = await generateRefId('entity-b');
    registerDocumentReferenceRuntimeHandler({
      documentType: 'graph-document',
      getCurrentDocumentId: () => null,
      listReferenceIds: vi.fn(async () => ['entity-a', 'entity-b']),
      waitForDocumentReady: vi.fn(async () => true),
      focusReference: vi.fn(async (): Promise<DocumentReferenceFocusResult> => ({ status: 'focused' })),
    });

    const resolved = await resolvePluginReferenceInDocument('graph-document', 'graph-doc-1', ref);

    expect(resolved).toEqual({
      documentId: 'graph-doc-1',
      docType: 'graph-document',
      resolvedId: 'entity-b',
    });
  });

  it('解析任意插件文档类型前缀并通过对应引用运行时解析 ref', async () => {
    const ref = await generateRefId('canvas-element-b');
    registerDocumentReferenceRuntimeHandler({
      documentType: 'canvas-document',
      getCurrentDocumentId: () => null,
      listReferenceIds: vi.fn(async () => ['canvas-element-a', 'canvas-element-b']),
      waitForDocumentReady: vi.fn(async () => true),
      focusReference: vi.fn(async (): Promise<DocumentReferenceFocusResult> => ({ status: 'focused' })),
    });

    expect(parseWorkspaceRefId(`${ref}@canvas-document:document-1`)).toEqual({
      ref,
      documentId: 'document-1',
      docTypeHint: 'canvas-document',
    });

    await expect(resolvePluginReferenceInDocument('canvas-document', 'document-1', ref))
      .resolves
      .toEqual({
        documentId: 'document-1',
        docType: 'canvas-document',
        resolvedId: 'canvas-element-b',
      });

    await expect(resolveReferenceMatches(ref, [{ documentId: 'document-1', docType: 'canvas-document' }]))
      .resolves
      .toEqual([{
        documentId: 'document-1',
        docType: 'canvas-document',
        resolvedId: 'canvas-element-b',
      }]);
  });

  it('引用展示语义来自插件运行时契约而不是 host 类型名', () => {
    registerDocumentReferenceRuntimeHandler({
      documentType: 'graph-document',
      referenceLabel: '节点引用',
      getCurrentDocumentId: () => 'graph-doc-current',
      listReferenceIds: vi.fn(async () => []),
      waitForDocumentReady: vi.fn(async () => true),
      focusReference: vi.fn(async (): Promise<DocumentReferenceFocusResult> => ({ status: 'focused' })),
    });

    expect(getPluginReferenceLabel('graph-document', conversationMessage)).toBe('节点引用');
    expect(getPluginReferenceLabel('canvas-document', conversationMessage)).toBe('Document reference');
    expect(findCurrentPluginReferenceDocument('graph-doc-current')).toEqual({
      documentId: 'graph-doc-current',
      docType: 'graph-document',
    });
    expect(findCurrentPluginReferenceDocument('other-doc')).toBeNull();
  });
});
