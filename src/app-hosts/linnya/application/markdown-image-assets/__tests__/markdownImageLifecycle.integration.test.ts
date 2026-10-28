import { createProjectLifecycle } from 'src/domains/projects';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { MARKDOWN_DOCUMENT_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/document.schema';
import { PENDING_REVISION_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/pending-revision.schema';
import { BLOCK_HISTORY_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/block-history.schema';
import { IMAGE_BLOCK_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/image.schema';
import { deriveConversationWorkDirectoryIdentity } from 'src/domains/conversation-files';
import { createManagedImageIngress } from 'src/domains/assets/features/managed-image-ingress';
import { createSqliteLocalImageAssetLedger } from 'src/domains/assets/features/local-image-registration';
import { createManagedImageStoragePaths } from 'src/domains/assets/shared/managed-image-storage';
import { createWorkspaceVerifiedImageLoader } from 'src/features/workspace/assets/shared/verified-image';
import { createNodePhysicalFileReader } from '../../../adapters/file-read/createNodePhysicalFileReader';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { createWorkspaceDocumentFileCreateProviderResolver } from '../../../adapters/document-file-create/createWorkspaceDocumentFileCreateProviderResolver';
import { createWorkspaceDocumentFileWriteProviderResolver } from '../../../adapters/document-file-write/createWorkspaceDocumentFileWriteProviderResolver';
import {
  PendingRevisionApplyService,
  collectMarkdownImages,
  readMarkdownVfsContent,
  createMarkdownReadDatabase,
} from 'src/domains/markdown';
import { projectMarkdownDocumentImages } from 'src/domains/markdown/features/document-read/functions/projectMarkdownDocumentImages';
import { createMarkdownDocumentStore } from '../createMarkdownDocumentStore';
import type { MarkdownImageSourceContext } from '../createMarkdownImageSourceResolver';
import { readDocumentImageAsset } from '../readDocumentImageAsset';

// 使用真实文件准入、managed ingress、SQLite、全文规划与修订服务覆盖所有权闭环。
describe('Markdown image lifecycle through Host providers', () => {
  let db: Database.Database;
  let root: string;
  let directory: string;
  let projectId: string;
  let workspace: WorkspaceService;
  let context: MarkdownImageSourceContext;
  let storeId: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-md-image-'));
    directory = path.join(root, 'conversation');
    await fs.mkdir(directory);
    db = new Database(path.join(root, 'workspace.sqlite'));
    db.pragma('foreign_keys = ON');
    for (const statement of [
      ...CORE_SCHEMAS,
      ...ASSET_LEDGER_SCHEMAS,
      ...MARKDOWN_DOCUMENT_SCHEMAS,
      ...PENDING_REVISION_SCHEMAS,
      ...BLOCK_HISTORY_SCHEMAS,
      ...IMAGE_BLOCK_SCHEMAS,
    ])
      db.exec(statement);
    workspace = new WorkspaceService(db);
    projectId = createProjectLifecycle(db).create({ name: 'Image lifecycle' });
    storeId = randomUUID();
    context = {
      conversationId: 'conversation',
      physicalFileReader: createNodePhysicalFileReader(),
      managedImageIngress: createManagedImageIngress({
        appDataRoot: root,
        storeId,
        maxImageBytes: 1024 * 1024,
        maxImagePixels: 10000,
        ledger: createSqliteLocalImageAssetLedger({ db }),
      }),
      conversationWorkDirectoryAdmission: {
        async withAdmission(input, admitted) {
          if (input.conversationId !== 'conversation') throw new Error('Wrong conversation');
          return admitted({
            identity: deriveConversationWorkDirectoryIdentity('conversation'),
            absolutePath: directory,
            status: 'existing',
          });
        },
      },
    };
    await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
      .png()
      .toFile(path.join(directory, 'plot.png'));
    await sharp({ create: { width: 8, height: 8, channels: 3, background: 'blue' } })
      .webp()
      .toFile(path.join(directory, 'second.webp'));
  });
  afterEach(async () => {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  async function create(content: string) {
    const provider = createWorkspaceDocumentFileCreateProviderResolver({
      db,
      context,
      workspaceService: workspace,
    })('report.md');
    if (!provider) throw new Error('Missing Markdown provider');
    const result = await provider.create({
      projectId,
      parentPath: '/',
      name: 'report.md',
      content,
    });
    const documentId = result.documentId;
    const store = createMarkdownDocumentStore(db);
    const identity = {
      documentId,
      documentName: 'report.md',
      documentType: 'document',
      projectId,
      path: '/report.md',
      inode: `workspace:${documentId}`,
    };
    const writer = createWorkspaceDocumentFileWriteProviderResolver({ db, context })('document');
    if (!writer) throw new Error('Missing writer');
    const read = () =>
      readMarkdownVfsContent({ db: createMarkdownReadDatabase(db), documentId })!.text;
    const decide = (mode: 'accept' | 'reject', blockId?: string) =>
      new PendingRevisionApplyService(store).commitEditorRevision({
        documentId,
        expectedVersionNumber: store.getLatestVersion(documentId)!.version_number,
        expectedPending: store
          .getPendingRevisions(documentId)
          .map(({ id, revision }) => ({ id, revision })),
        baseline: store.getDocument(documentId),
        decision: { mode, ...(blockId ? { blockId } : {}) },
      });
    const owned = () =>
      db
        .prepare<[string], { asset_id: string }>(
          'SELECT asset_id FROM document_asset_links WHERE document_node_id = ?'
        )
        .all(documentId)
        .map(row => row.asset_id);
    return { store, identity, writer, read, decide, owned };
  }

  it('creates, copies, continues editing after source deletion, accepts and preserves assets reachable from history', async () => {
    const { store, identity, writer, read, decide, owned } = await create(
      '![原图](conversation:/plot.png)\n\n说明\n\n![副本](conversation:/plot.png)'
    );
    const images = collectMarkdownImages(store.getDocument(identity.documentId));
    expect(images).toHaveLength(2);
    expect(images[0].id).not.toBe(images[1].id);
    expect(images[0].assetId).toBe(images[1].assetId);
    expect(owned()).toEqual([images[0].assetId]);
    expect(read()).not.toContain(root);
    await fs.rm(path.join(directory, 'plot.png'));
    await writer.write({ identity, operation: 'write', content: read().replace('原图', '新题注') });
    expect(
      projectMarkdownDocumentImages(
        store.getDocument(identity.documentId),
        store.getPendingRevisions(identity.documentId)
      )[0].caption
    ).toBe('新题注');
    await decide('accept');
    expect(collectMarkdownImages(store.getDocument(identity.documentId))[0]).toMatchObject({
      id: images[0].id,
      caption: '新题注',
    });
    await writer.write({ identity, operation: 'write', content: '删除图片后的正文' });
    await decide('accept');
    expect(collectMarkdownImages(store.getDocument(identity.documentId))).toEqual([]);
    expect(owned()).toEqual([images[0].assetId]);
    const loader = createWorkspaceVerifiedImageLoader({
      db,
      storageBoundaries: [
        {
          boundaryRoot: root,
          contentRoot: createManagedImageStoragePaths(root, storeId).contentRoot,
        },
      ],
      maxImagePixels: 10000,
    });
    const loaded = await readDocumentImageAsset({ db, loader, assetId: images[0].assetId! });
    expect(loaded.mediaType).toBe('image/png');
  });

  it('releases rejected Pending-only ownership and rolls back document links with failed receipt commit', async () => {
    const { store, identity, writer, read, decide, owned } = await create('正文');
    await writer.write({
      identity,
      operation: 'write',
      content: `${read()}\n\n![新增](conversation:/second.webp)`,
    });
    expect(owned()).toHaveLength(1);
    await decide('reject');
    expect(owned()).toEqual([]);
    const failing = createWorkspaceDocumentFileWriteProviderResolver({
      db,
      context,
      resultCommit: {
        prepare() {},
        commit() {
          throw new Error('receipt-failure');
        },
      },
    })('document');
    const before = read();
    await expect(
      failing!.write({
        identity,
        operation: 'write',
        content: `${before}\n\n![失败](conversation:/second.webp)`,
      })
    ).rejects.toThrow('receipt-failure');
    expect(read()).toBe(before);
    expect(store.getPendingRevisions(identity.documentId)).toEqual([]);
    expect(owned()).toEqual([]);
  });

  it('restores Pending from SQLite and retains a shared asset across independent accept/reject decisions', async () => {
    const { store, identity, writer, read, decide, owned } = await create('原文');
    await writer.write({
      identity,
      operation: 'write',
      content: `${read()}\n\n![一](conversation:/plot.png)\n\n![二](conversation:/plot.png)`,
    });
    const reopenedDb = new Database(path.join(root, 'workspace.sqlite'));
    try {
      const reopened = createMarkdownDocumentStore(reopenedDb);
      const projected = projectMarkdownDocumentImages(
        reopened.getDocument(identity.documentId),
        reopened.getPendingRevisions(identity.documentId)
      );
      expect(projected.map(image => image.caption)).toEqual(['一', '二']);
      expect(projected[0]).toMatchObject({ width: 8, height: 8 });
    } finally {
      reopenedDb.close();
    }
    const pendings = store.getPendingRevisions(identity.documentId);
    expect(pendings).toHaveLength(2);
    await decide('accept', pendings[0].target_block_id);
    await decide('reject', pendings[1].target_block_id);
    expect(collectMarkdownImages(store.getDocument(identity.documentId))).toHaveLength(1);
    expect(owned()).toHaveLength(1);
    const assetId = owned()[0];
    const loader = createWorkspaceVerifiedImageLoader({
      db,
      storageBoundaries: [
        {
          boundaryRoot: root,
          contentRoot: createManagedImageStoragePaths(root, storeId).contentRoot,
        },
      ],
      maxImagePixels: 10000,
    });
    const asset = db
      .prepare<[string], { local_path: string }>('SELECT local_path FROM assets WHERE id = ?')
      .get(assetId)!;
    await fs.writeFile(asset.local_path, 'corrupt bytes');
    await expect(readDocumentImageAsset({ db, loader, assetId })).rejects.toThrow();
    await expect(readDocumentImageAsset({ db, loader, assetId: 'unknown' })).rejects.toThrow(
      'asset_unavailable'
    );
  });

  it('rejects paths outside the conversation and rejects mixed/unknown images without partial document changes', async () => {
    const { identity, writer, read, owned } = await create('原文');
    await fs.symlink(path.join(root, 'outside.png'), path.join(directory, 'escape.png'));
    await fs.writeFile(
      path.join(directory, 'unsupported.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'
    );
    await sharp({ create: { width: 8, height: 8, channels: 3, background: 'green' } })
      .png()
      .toFile(path.join(root, 'outside.png'));
    for (const content of [
      '正文改变\n\n![逃逸](conversation:/escape.png)',
      '正文改变\n\n![未知](linnya-image://missing)',
      '正文 ![混排](conversation:/plot.png)',
      '![SVG](conversation:/unsupported.svg)',
    ]) {
      await expect(writer.write({ identity, operation: 'write', content })).rejects.toThrow();
      expect(read()).toBe('原文');
      expect(owned()).toEqual([]);
    }
  });
});
