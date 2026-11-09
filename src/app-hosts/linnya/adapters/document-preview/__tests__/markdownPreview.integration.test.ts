import Database from 'better-sqlite3';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentPreviewContentSchema, MarkdownImageAttrsSchema, type WorkspaceMarkdownPreview } from '@app/schemas';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { MARKDOWN_DOCUMENT_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/document.schema';
import { PENDING_REVISION_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/pending-revision.schema';
import { BLOCK_HISTORY_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/block-history.schema';
import { IMAGE_BLOCK_SCHEMAS } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schemas/blocks/image.schema';
import { DOCUMENT_REFERENCE_SCHEMAS } from 'src/domains/document-references';
import { createProjectLifecycle } from 'src/domains/projects';
import { ensureManagedImageStoreBinding } from 'src/domains/assets/features/managed-image-store-binding';
import { createDocumentImageAssetRuntime } from 'src/plugin-sdk/backend/documentImageAsset';
import { createMarkdownPreviewCapability, PendingRevisionApplyService, type MarkdownDocJson, type ProseMirrorJsonNode } from 'src/domains/markdown';
import { createMarkdownDocumentStore } from '../../../application/markdown-image-assets/createMarkdownDocumentStore';
import { embedImageBytes } from 'src/electron-main/services/mediaService';
import * as pathManager from 'src/shared/utils/pathManager';
import { createMarkdownPreviewResources } from '../createMarkdownPreviewResources';

const request = { documentId: 'doc', context: {}, widthPx: 640, pixelRatio: 2 };
function block(id: string, content: ProseMirrorJsonNode): ProseMirrorJsonNode {
  return { type: 'rootBlock', attrs: { id, backgroundColor: 'blue_bg' }, content: [content] };
}
function paragraph(text: string): ProseMirrorJsonNode {
  return block('text', { type: 'baseBlock', attrs: { id: 'text-inner' }, content: [{ type: 'text', text, marks: [{ type: 'bold' }] }] });
}
function detail(content: unknown): WorkspaceMarkdownPreview {
  const parsed = DocumentPreviewContentSchema.parse(content);
  if (parsed.detail?.format !== 'workspace-markdown') throw new Error('Expected canonical document preview');
  return parsed.detail;
}

describe('canonical Markdown preview through Host resources', () => {
  let db: Database.Database;
  let root: string;
  let previousRoot: string;
  let projectId: string;
  beforeEach(async () => {
    previousRoot = pathManager.getWorkspaceRoot();
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-canonical-preview-'));
    pathManager.setWorkspaceRoot(root);
    vi.spyOn(pathManager, 'getAppDataPath').mockReturnValue(root);
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    for (const statement of [...CORE_SCHEMAS, ...DOCUMENT_REFERENCE_SCHEMAS, ...ASSET_LEDGER_SCHEMAS, ...MARKDOWN_DOCUMENT_SCHEMAS, ...PENDING_REVISION_SCHEMAS, ...BLOCK_HISTORY_SCHEMAS, ...IMAGE_BLOCK_SCHEMAS]) db.exec(statement);
    projectId = createProjectLifecycle(db).create({ name: 'Preview project' });
    for (const id of ['doc', 'target', 'foreign']) db.prepare("INSERT INTO workspace_nodes (id, project_id, type, name, created_at, updated_at) VALUES (?, ?, 'document', ?, 1, 1)").run(id, projectId, id);
    ensureManagedImageStoreBinding({ db });
  });
  afterEach(async () => {
    db.close(); vi.restoreAllMocks(); pathManager.setWorkspaceRoot(previousRoot);
    await fs.rm(root, { recursive: true, force: true });
  });
  const changes = () => db.prepare('SELECT total_changes() AS count').get();

  it('keeps formal rich structure, manual document media and managed images, while generating bounded readonly pixels', async () => {
    const bytes = await sharp({ create: { width: 3000, height: 100, channels: 4, background: '#ff000080' } }).png().toBuffer();
    const manual = await embedImageBytes({ documentNodeId: 'doc', imageDataBuffer: Uint8Array.from(bytes).buffer, extension: 'png' });
    if (!manual.locator) throw new Error('Missing embedded image locator');
    const managed = await createDocumentImageAssetRuntime(db).adoptImageBytes({ documentId: 'doc', bytes, usageHint: 'markdown-image' });
    const image = MarkdownImageAttrsSchema.parse({ id: 'manual', src: manual.locator, alt: '手动图片', caption: '透明图片' });
    const canonical: MarkdownDocJson = { type: 'doc', content: [paragraph('用户正文'),
      block('manual-root', { type: 'imageBlock', attrs: image }),
      block('managed-root', { type: 'imageBlock', attrs: { ...image, id: 'managed', assetId: managed.assetId, src: 'media://load/asset-image/managed' } }),
      block('chart-root', { type: 'chartBlock', attrs: { id: 'chart', spec: { chartType: 'bar', title: '销量', categories: ['一'], series: [{ name: '金额', values: [3] }] } } }),
    ] };
    const store = createMarkdownDocumentStore(db); store.createDocument('doc', canonical);
    const before = changes();
    const content = await createMarkdownPreviewCapability(db, createMarkdownPreviewResources(db)).render(request);
    const preview = detail(content);
    expect(preview.document).toEqual(store.getDocument('doc'));
    expect(content.summary).toContain('用户正文'); expect(content.summary).not.toContain('chartType');
    expect(Object.keys(preview.assets)).toEqual(['manual', managed.assetId]);
    for (const dataUri of Object.values(preview.assets)) {
      const meta = await sharp(Buffer.from(dataUri.split(',')[1], 'base64')).metadata();
      expect(meta.width).toBe(2048); expect(meta.hasAlpha).toBe(true);
    }
    expect(changes()).toEqual(before);
  });

  it('shows saved Pending without accepting it, and follows reject, accept and empty-document decisions', async () => {
    const store = createMarkdownDocumentStore(db); store.createDocument('doc', { type: 'doc', content: [paragraph('旧正文')] });
    const preview = createMarkdownPreviewCapability(db, createMarkdownPreviewResources(db));
    const baselineRevision = await preview.getRevision(request);
    store.setPendingRevision('doc', 'text', '**新正文**', 'tool', { operation: 'update' });
    const pendingRevision = await preview.getRevision(request), before = changes();
    const content = await preview.render(request);
    expect(content.summary).toBe('新正文');
    expect(JSON.stringify(detail(content).document)).toContain('blue_bg');
    expect(JSON.stringify(detail(content).document)).toContain('bold');
    expect(store.getDocument('doc').content[0]?.content?.[0]?.content?.[0]?.text).toBe('旧正文');
    expect(store.getPendingRevisions('doc')).toHaveLength(1); expect(changes()).toEqual(before);
    expect(pendingRevision).not.toBe(baselineRevision);
    const decide = (mode: 'accept' | 'reject') => new PendingRevisionApplyService(store).commitEditorRevision({ documentId: 'doc', expectedVersionNumber: store.getLatestVersion('doc')!.version_number, expectedPending: store.getPendingRevisions('doc').map(({ id, revision }) => ({ id, revision })), baseline: store.getDocument('doc'), decision: { mode } });
    await decide('reject'); expect((await preview.render(request)).summary).toBe('旧正文');
    store.setPendingRevision('doc', 'text', '**接受正文**', 'tool', { operation: 'update' });
    const beforeAccept = await preview.getRevision(request); await decide('accept');
    expect((await preview.render(request)).summary).toBe('接受正文'); expect(await preview.getRevision(request)).not.toBe(beforeAccept);
    store.setPendingRevision('doc', 'text', '', 'tool', { operation: 'delete' });
    expect(detail(await preview.render(request)).document).toEqual({ type: 'doc', content: [] });
  });

  it('restores persisted Pending image and reference identities through the same preparation as acceptance', async () => {
    const capability = createMarkdownPreviewCapability(db, createMarkdownPreviewResources(db));
    const bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: 'blue' } }).png().toBuffer();
    const embedded = await embedImageBytes({ documentNodeId: 'doc', imageDataBuffer: Uint8Array.from(bytes).buffer, extension: 'png' });
    const image = MarkdownImageAttrsSchema.parse({ id: 'pending-image', src: embedded.locator, alt: '图片来源' });
    const store = createMarkdownDocumentStore(db);
    store.createDocument('doc', { type: 'doc', content: [
      block('image-slot', { type: 'baseBlock', attrs: { id: 'image-slot-inner' }, content: [] }),
      block('reference-slot', { type: 'baseBlock', attrs: { id: 'reference-slot-inner' }, content: [] }),
    ] });
    store.setPendingRevision('doc', 'image-slot', '![最新题注](linnya-image://pending-image)', 'tool', { operation: 'update', image });
    store.setPendingRevision('doc', 'reference-slot', '[target](workspace:/target.md)', 'tool', {
      operation: 'update', document_reference_bindings: [{ referenceId: 'saved-ref', targetDocumentId: 'target', path: 'workspace:/target.md', label: 'target' }],
    });
    db.prepare("UPDATE workspace_nodes SET name = '当前标题' WHERE id = 'target'").run();
    const before = changes();
    const content = await capability.render(request);
    const preview = detail(content);
    expect(JSON.stringify(preview.document)).toContain('最新题注');
    expect(JSON.stringify(preview.document)).toContain('documentReference');
    expect(JSON.stringify(preview.document)).toContain('saved-ref');
    expect(preview.references.target.title).toBe('当前标题');
    expect(content.summary).toContain('当前标题');
    expect(preview.assets['pending-image']).toMatch(/^data:image\/png;base64,/);
    expect(store.getPendingRevisions('doc')).toHaveLength(2); expect(changes()).toEqual(before);
  });

  it('keys cache revisions by current reference presentation and never leaks a moved target title', async () => {
    const canonical: MarkdownDocJson = { type: 'doc', content: [block('ref-root', { type: 'baseBlock', attrs: { id: 'ref-inner' }, content: [{ type: 'documentReference', attrs: { referenceId: 'reference-1', documentId: 'target' } }] })] };
    const store = createMarkdownDocumentStore(db); store.createDocument('doc', canonical);
    const preview = createMarkdownPreviewCapability(db, createMarkdownPreviewResources(db));
    const original = await preview.getRevision(request);
    db.prepare("UPDATE workspace_nodes SET name = '改名' WHERE id = 'target'").run();
    expect(await preview.getRevision(request)).not.toBe(original);
    expect(detail(await preview.render(request)).references.target.title).toBe('改名');
    const other = createProjectLifecycle(db).create({ name: 'Other project' });
    db.prepare("UPDATE workspace_nodes SET project_id = ? WHERE id = 'target'").run(other);
    expect(detail(await preview.render(request)).references.target).toEqual({ documentId: 'target', status: 'outside_project', title: null, nodeType: null });
  });

  it('enforces document ownership on manual images and aborts after an asynchronous image read', async () => {
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).png().toBuffer();
    const manual = await embedImageBytes({ documentNodeId: 'foreign', imageDataBuffer: Uint8Array.from(bytes).buffer, extension: 'png' });
    const image = MarkdownImageAttrsSchema.parse({ id: 'img', src: manual.locator });
    const resources = createMarkdownPreviewResources(db);
    await expect(resources.readImage({ documentId: 'doc', image })).rejects.toThrow();
    const store = createMarkdownDocumentStore(db); store.createDocument('doc', { type: 'doc', content: [block('img-root', { type: 'imageBlock', attrs: image })] });
    const abort = new AbortController();
    const preview = createMarkdownPreviewCapability(db, { ...resources, readImage: async () => { abort.abort(); return 'data:image/png;base64,eA=='; } });
    await expect(preview.render({ ...request, signal: abort.signal })).rejects.toThrow();
  });
});
