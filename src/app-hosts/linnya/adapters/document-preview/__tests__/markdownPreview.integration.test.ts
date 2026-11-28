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
import { createFileImageVariantCache } from 'src/domains/document-preview';
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
  const variantDirectory = () => path.join(root, 'preview-images');
  const createResources = () => createMarkdownPreviewResources(db, createFileImageVariantCache(variantDirectory()));

  it('keeps formal rich structure, lists manual and managed images without their bytes, and serves each tier once from bounded pixels', async () => {
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
    const capability = createMarkdownPreviewCapability(db, createResources());
    const content = await capability.render(request);
    const preview = detail(content);
    expect(preview.document).toEqual(store.getDocument('doc'));
    expect(content.summary).toContain('用户正文'); expect(content.summary).not.toContain('chartType');
    // 预览只列清单：来源与原图尺寸，顺序同正文；两张 3000px 的图不再把结果撑到 MB 级。
    expect(Object.entries(preview.images)).toEqual([
      ['manual', { source: { src: manual.locator }, widthPx: 3000, heightPx: 100 }],
      [managed.assetId, { source: { assetId: managed.assetId }, widthPx: 3000, heightPx: 100 }],
    ]);
    expect(JSON.stringify(content).length).toBeLessThan(16_000);
    const readImage = capability.readImage;
    if (!readImage) throw new Error('Markdown preview must serve its images');
    const read = (source: WorkspaceMarkdownPreview['images'][string]['source'], maxEdgePx: 512 | 1024) =>
      readImage({ context: {}, documentId: 'doc', source, maxEdgePx });
    for (const { source } of Object.values(preview.images)) {
      const image = await read(source, 1024);
      if (!image) throw new Error('Listed image must be readable');
      const meta = await sharp(image.bytes).metadata();
      expect(image.mimeType).toBe('image/png'); expect(meta.width).toBe(1024); expect(meta.hasAlpha).toBe(true);
      // 同一档再取一次来自磁盘缓存，字节相同；另一档单独生成。
      expect((await read(source, 1024))?.bytes).toEqual(image.bytes);
      expect((await sharp((await read(source, 512))?.bytes).metadata()).width).toBe(512);
    }
    expect((await fs.readdir(variantDirectory())).filter(name => name.endsWith('.img'))).toHaveLength(4);
    expect(changes()).toEqual(before);
  });

  it('shows saved Pending without accepting it, and follows reject, accept and empty-document decisions', async () => {
    const store = createMarkdownDocumentStore(db); store.createDocument('doc', { type: 'doc', content: [paragraph('旧正文')] });
    const preview = createMarkdownPreviewCapability(db, createResources());
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
    const capability = createMarkdownPreviewCapability(db, createResources());
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
    expect(preview.images['pending-image']).toEqual({ source: { src: embedded.locator }, widthPx: 12, heightPx: 8 });
    expect(store.getPendingRevisions('doc')).toHaveLength(2); expect(changes()).toEqual(before);
  });

  it('keys cache revisions by current reference presentation and never leaks a moved target title', async () => {
    const canonical: MarkdownDocJson = { type: 'doc', content: [block('ref-root', { type: 'baseBlock', attrs: { id: 'ref-inner' }, content: [{ type: 'documentReference', attrs: { referenceId: 'reference-1', documentId: 'target' } }] })] };
    const store = createMarkdownDocumentStore(db); store.createDocument('doc', canonical);
    const preview = createMarkdownPreviewCapability(db, createResources());
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
    if (!manual.locator) throw new Error('Missing embedded image locator');
    const image = MarkdownImageAttrsSchema.parse({ id: 'img', src: manual.locator });
    const resources = createResources();
    await expect(resources.readImageSize({ documentId: 'doc', image })).rejects.toThrow();
    await expect(resources.readImageVariant({ documentId: 'doc', source: { src: manual.locator }, maxEdgePx: 512 })).rejects.toThrow();
    // 受管资产同样只对拥有它的文档开放，命中缩图缓存也不例外。
    const managed = await createDocumentImageAssetRuntime(db).adoptImageBytes({ documentId: 'foreign', bytes, usageHint: 'markdown-image' });
    expect(await resources.readImageVariant({ documentId: 'foreign', source: { assetId: managed.assetId }, maxEdgePx: 512 })).not.toBeNull();
    await expect(resources.readImageVariant({ documentId: 'doc', source: { assetId: managed.assetId }, maxEdgePx: 512 })).rejects.toThrow();
    const store = createMarkdownDocumentStore(db); store.createDocument('doc', { type: 'doc', content: [block('img-root', { type: 'imageBlock', attrs: image })] });
    const abort = new AbortController();
    const preview = createMarkdownPreviewCapability(db, { ...resources, readImageSize: async () => { abort.abort(); return { widthPx: 8, heightPx: 8 }; } });
    await expect(preview.render({ ...request, signal: abort.signal })).rejects.toThrow();
  });
});
