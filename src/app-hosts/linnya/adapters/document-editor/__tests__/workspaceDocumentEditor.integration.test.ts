import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { WorkspaceMutationEvent } from '@app/schemas';
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import {
  MarkdownDocumentService,
  type MarkdownDocJson,
} from 'src/domains/markdown';
import { AUDIO_BLOCK_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/audio.schema';
import { BLOCK_HISTORY_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/block-history.schema';
import { IMAGE_BLOCK_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/image.schema';
import { PENDING_REVISION_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/pending-revision.schema';
import { MARKDOWN_DOCUMENT_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/document.schema';
import { WorkspaceService } from '../../../../../electron-main/services/workspace/workspace';
import { readWorkspaceEditorDocument } from '../../../../../features/workspace/document-editor/orchestration/readWorkspaceEditorDocument';
import { writeWorkspaceEditorDocument } from '../../../../../features/workspace/document-editor/orchestration/writeWorkspaceEditorDocument';
import type { WorkspaceMutationPublisher } from '../../../../../features/workspace/definitions/workspaceMutationPublisher';
import { CORE_SCHEMAS } from '../../../../../features/workspace/infrastructure/sqlite/schemas/core.schema';
import { createWorkspaceDocumentEditorProviderResolver } from '../createWorkspaceDocumentEditorProviderResolver';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const statement of [
    ...CORE_SCHEMAS,
    ...ASSET_LEDGER_SCHEMAS,
    ...MARKDOWN_DOCUMENT_SCHEMAS,
    ...AUDIO_BLOCK_SCHEMAS,
    ...IMAGE_BLOCK_SCHEMAS,
    ...BLOCK_HISTORY_SCHEMAS,
    ...PENDING_REVISION_SCHEMAS,
  ]) {
    db.exec(statement);
  }
  return db;
}

function markdownDocument(text: string): MarkdownDocJson {
  return {
    type: 'doc',
    content: [
      {
        type: 'rootBlock',
        attrs: { id: 'root-editor-integration' },
        content: [
          {
            type: 'baseBlock',
            attrs: { id: 'base-editor-integration', blockType: 'base' },
            content: text ? [{ type: 'text', text }] : [],
          },
        ],
      },
    ],
  };
}

function createRecordingPublisher(
  events: WorkspaceMutationEvent[],
): WorkspaceMutationPublisher {
  return {
    publish(event) {
      events.push(event);
    },
  };
}

function readCount(value: unknown): number {
  if (!value || typeof value !== 'object') {
    throw new Error('Expected count row object');
  }
  const count = Reflect.get(value, 'count');
  if (typeof count !== 'number') {
    throw new Error('Expected numeric count');
  }
  return count;
}

describe('Workspace document Editor provider integration', () => {
  it('通过内建 Markdown provider 读写状态化文档并发布版本事件', async () => {
    const db = createDb();
    try {
      const events: WorkspaceMutationEvent[] = [];
      const workspaceService = new WorkspaceService(db);
      const projectId = workspaceService.createProject('Editor 集成测试');
      const documentId = workspaceService.createDocument(
        projectId,
        '正文.md',
        null,
        'document',
      );
      const documentStore = new MarkdownDocumentService(db);
      documentStore.createDocument(documentId, markdownDocument('初始正文'));
      documentStore.setPendingRevision(
        documentId,
        'root-editor-integration',
        '建议正文',
        'user',
      );
      const resolveProvider = createWorkspaceDocumentEditorProviderResolver({
        db,
        mutationPublisher: createRecordingPublisher(events),
      });

      const before = await readWorkspaceEditorDocument({
        documentId,
        workspaceService,
        resolveProvider,
      });
      expect(before.content).toEqual(markdownDocument('初始正文'));
      expect(before.pendingRevisions).toEqual([
        expect.objectContaining({
          blockId: 'root-editor-integration',
          newMarkdown: '建议正文',
          source: 'user',
          operation: null,
        }),
      ]);

      const written = await writeWorkspaceEditorDocument({
        documentId,
        content: markdownDocument('保存后的正文'),
        workspaceService,
        resolveProvider,
      });
      expect(written.versionNumber).toBe(2);
      expect(new MarkdownDocumentService(db).getDocument(documentId))
        .toEqual(markdownDocument('保存后的正文'));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'workspace.document.updated',
        projectId,
        documentId,
        nodeType: 'document',
        mutationKind: 'version',
        versionNumber: 2,
        source: 'user',
      });
    } finally {
      db.close();
    }
  });

  it('未知文档类型没有 Editor provider 时明确拒绝且不写入 Markdown 版本', async () => {
    const db = createDb();
    try {
      const workspaceService = new WorkspaceService(db);
      const projectId = workspaceService.createProject('未知类型测试');
      const documentId = workspaceService.createDocument(
        projectId,
        '未知文档',
        null,
        'unknown-document-type',
      );
      const resolveProvider = createWorkspaceDocumentEditorProviderResolver({
        db,
        mutationPublisher: createRecordingPublisher([]),
      });

      await expect(writeWorkspaceEditorDocument({
        documentId,
        content: markdownDocument('不应写入'),
        workspaceService,
        resolveProvider,
      })).rejects.toThrow('不支持富文档 Editor 写入');

      const versionCount = readCount(db.prepare(`
        SELECT COUNT(*) AS count
        FROM document_versions
        WHERE node_id = ?
      `).get(documentId));
      expect(versionCount).toBe(0);
    } finally {
      db.close();
    }
  });
});
