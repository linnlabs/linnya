import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { PluginToolContext } from '@linnya/plugin-host-contract/backend/toolRuntime';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { MARKDOWN_DOCUMENT_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/document.schema';
import { PENDING_REVISION_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/pending-revision.schema';
import { BLOCK_HISTORY_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/block-history.schema';
import { IMAGE_BLOCK_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/image.schema';
import { MarkdownDocumentService, PendingRevisionApplyService, buildMarkdownCitationReadProjection } from 'src/domains/markdown';
import { attachCitationSourceResolver, type WebCitationSource } from 'src/domains/citation';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { createWorkspaceDocumentFileCreateProviderResolver } from '../../document-file-create/createWorkspaceDocumentFileCreateProviderResolver';
import { createWorkspaceDocumentFileWriteProviderResolver } from '../createWorkspaceDocumentFileWriteProviderResolver';

const source: WebCitationSource = {
  sourceType: 'web', ref: 'Abc234', url: 'https://example.com/report',
  title: 'Report', snippet: 'A saved snapshot',
};

describe('Markdown citation receipt through Host providers', () => {
  it('报告提交后的全文来源，允许零引用；pending接受、拒绝和重复引用不会误计', async () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      for (const sql of [...CORE_SCHEMAS, ...ASSET_LEDGER_SCHEMAS, ...MARKDOWN_DOCUMENT_SCHEMAS,
        ...PENDING_REVISION_SCHEMAS, ...BLOCK_HISTORY_SCHEMAS, ...IMAGE_BLOCK_SCHEMAS]) db.exec(sql);
      const workspaceService = new WorkspaceService(db);
      const projectId = workspaceService.createProject('Citation receipt');
      const context: PluginToolContext = { conversationId: 'receipt-test' };
      attachCitationSourceResolver(context, {
        resolveSources: async refs => refs.includes(source.ref) ? [source] : [],
        resolveSourcesByUrl: async urls => urls.includes(source.url) ? [source] : [],
      });
      const create = createWorkspaceDocumentFileCreateProviderResolver({ db, context, workspaceService })('report.md');
      const writer = createWorkspaceDocumentFileWriteProviderResolver({ db, context })('document');
      if (!create || !writer) throw new Error('Markdown provider missing');
      const plain = '自己的笔记。`[@Abc234]` 是代码示例。\n\n[普通链接](https://example.com/unread)';
      const created = await create.create({ projectId, parentPath: '/', name: 'report.md', content: plain });
      const identity = { documentId: created.documentId, documentName: 'report.md', documentType: 'document',
        projectId, path: '/report.md', inode: `workspace:${created.documentId}` };
      expect(created.buildObservation(identity)).not.toContain('引用来源');
      const store = new MarkdownDocumentService(db);
      const count = () => buildMarkdownCitationReadProjection({ content: store.getDocument(created.documentId),
        pendings: store.getPendingRevisions(created.documentId), viewMode: 'preview', includeAnnotations: false,
      }).citationProjection.sources.length;
      const write = (content: string) => writer.write({ identity, operation: 'write', content });
      const decide = async (mode: 'accept' | 'reject') => {
        const version = store.getLatestVersion(created.documentId);
        if (!version) throw new Error('Missing document version');
        await new PendingRevisionApplyService(store).commitEditorRevision({
          documentId: created.documentId, expectedVersionNumber: version.version_number,
          expectedPending: store.getPendingRevisions(created.documentId).map(({ id, revision }) => ({ id, revision })),
          baseline: store.getDocument(created.documentId), decision: { mode },
        });
      };
      const cited = '说明 [@Abc234]。\n\n另一个段落 [@Abc234]。';
      expect((await write(cited)).observation).toContain('全文可解析引用来源：1');
      expect(count()).toBe(1);
      await decide('reject');
      expect(count()).toBe(0);
      expect((await write(plain)).observation).not.toContain('引用来源');
      await write(cited);
      await decide('accept');
      expect(count()).toBe(1);
      // 只改正文，回执仍应报告全文来源，而非本次替换片段里的引用数。
      expect((await writer.write({ identity, operation: 'edit', replacedCount: 1,
        content: cited.replace('说明', '修订说明'), expectedCurrentText: cited,
      })).observation).toContain('全文可解析引用来源：1');
      expect((await write('删除引用后的普通正文')).observation).not.toContain('引用来源');
      expect(count()).toBe(0);
      await decide('reject');
      expect(count()).toBe(1);
      await write('删除引用后的普通正文');
      await decide('accept');
      expect(count()).toBe(0);
      const linked = await create.create({ projectId, parentPath: '/', name: 'linked.md',
        content: '[已接纳报告](https://example.com/report) 与 [同一报告](https://example.com/report)',
      });
      expect(linked.buildObservation({ path: '/linked.md', inode: `workspace:${linked.documentId}` }))
        .toContain('全文可解析引用来源：1');
      await expect(write('未知来源 [@Def567]')).rejects.toThrow();
      expect(count()).toBe(0);
    } finally {
      db.close();
    }
  });
});
