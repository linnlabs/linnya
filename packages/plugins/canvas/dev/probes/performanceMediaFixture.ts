import type { DocumentImageAsset, DocumentPreviewResult, DocumentReferencePresentation } from '@app/schemas';
import { CanvasCardSchema, type CanvasElement } from '../../src/shared';
import { createCanvasCardContent, type CanvasCardMediaPort } from '../../src/renderer/features/cardMedia';

export type CanvasPerformanceKind = 'text' | 'image' | 'document';
type ReadKind = 'image' | 'preview' | 'reference';

async function displayImage(): Promise<DocumentImageAsset> {
  const canvas = new OffscreenCanvas(640, 400), context = canvas.getContext('2d');
  if (!context) throw new Error('media_fixture_context_missing');
  context.fillStyle = '#1478b8'; context.fillRect(0, 0, 640, 400);
  context.fillStyle = '#e86424'; context.fillRect(320, 0, 320, 200); context.fillRect(0, 200, 320, 200);
  const blob = await canvas.convertToBlob({ type: 'image/png' }), bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return { assetId: 'fixed-managed-raster', mediaType: 'image/png', byteLength: bytes.length,
    width: 640, height: 400, displayWidth: 640, displayHeight: 400,
    sha256: Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join(''), dataUri: `data:image/png;base64,${btoa(binary)}` };
}

/** Host只读端口夹具；正式provider拥有4并发预读、128项/32MiB预览和图片显示缓存。 */
export async function canvasPerformanceMediaFixture(elements: readonly CanvasElement[], kind: CanvasPerformanceKind) {
  const reads = { image: 0, preview: 0, reference: 0 }, active = { ...reads }, peak = { ...reads }, perDocument = new Map<string, number>();
  const asset = kind === 'text' ? null : await displayImage();
  async function request<T>(type: ReadKind, value: T): Promise<T> {
    reads[type]++; active[type]++; peak[type] = Math.max(peak[type], active[type]);
    try { await new Promise<void>(resolve => setTimeout(resolve, 0)); return structuredClone(value); }
    finally { active[type]--; }
  }
  const port: CanvasCardMediaPort = {
    readImage: async () => { if (!asset) throw new Error('media_fixture_asset_missing'); return request('image', asset); },
    preview: async input => {
      if (!asset) throw new Error('media_fixture_asset_missing');
      const covered = Number(input.documentId.slice('authorized-document-'.length)) % 2 === 0;
      perDocument.set(input.documentId, (perDocument.get(input.documentId) ?? 0) + 1);
      const value: DocumentPreviewResult = { documentId: input.documentId, title: `授权文档 ${input.documentId}`, nodeType: 'fixture-document', status: 'ready',
        content: { revisionKey: 'fixed-current-1', summary: '同项目当前摘要。中英文内容与换行来自正式文档表面投影，不能用空白卡代表真实渲染。',
          detail: { format: 'text', text: '授权文档只读正文。' }, overview: covered ? 'thumbnail' : 'title',
          ...(covered ? { image: { dataUri: asset.dataUri, widthPx: asset.displayWidth, heightPx: asset.displayHeight } } : {}) } };
      return request('preview', value);
    },
    reference: async documentId => {
      const value: DocumentReferencePresentation = { documentId, status: 'available', title: `授权文档 ${documentId}`, nodeType: 'fixture-document', path: `workspace:/${documentId}.md` };
      return request('reference', value);
    },
    projectId: () => 'fixed-authorized-project', subscribe: () => () => {}, subscribeAvailability: () => () => {}, openDocument: async () => {},
  };
  const data = elements.map((element): CanvasElement => {
    if (kind === 'text' || element.type === 'edge') return element;
    return CanvasCardSchema.parse({ ...element, type: kind, data: kind === 'image'
      ? { assetId: 'fixed-managed-raster', caption: `受管图片 ${element.id}`, alt: '蓝橙双色固定显示派生', crop: null }
      : { documentId: `authorized-document-${element.id.slice(1)}` } });
  });
  return { elements: data, content: kind === 'text' ? null : createCanvasCardContent('media-performance-canvas', port),
    readStats: () => ({ kind, reads: { ...reads }, active: { ...active }, peak: { ...peak }, distinctPreviewDocuments: perDocument.size,
      maximumReadsPerDocument: Math.max(0, ...perDocument.values()), width: asset?.displayWidth ?? 0, height: asset?.displayHeight ?? 0 }) };
}
