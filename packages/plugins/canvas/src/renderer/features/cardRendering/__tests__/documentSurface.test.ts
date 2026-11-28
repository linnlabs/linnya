// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { disposeDocumentPreviewSurface } from '@linnya/document-preview';
import { CanvasCardSchema } from '../../../../shared';
import { CanvasRenderRequestSchema } from '../../../../shared/rendering';
import { createCardSurface } from '../../../hidden-render-worker/functions/createCardSurface';
import { createCanvasCardContent, type CanvasCardMediaPort } from '../../cardMedia';

const source = { kind: 'user', conversationId: null, runId: null };
const card = CanvasCardSchema.parse({
  id: 'c1',
  type: 'document',
  schemaVersion: 1,
  revision: 1,
  order: 'a0',
  locked: false,
  color: 'white',
  createdBy: source,
  updatedBy: source,
  createdAt: 0,
  updatedAt: 0,
  x: 0,
  y: 0,
  width: 280,
  height: 180,
  parentId: null,
  data: { documentId: 'internal-target-id' },
});
const request = CanvasRenderRequestSchema.parse({
  protocol: 1,
  requestId: 'summary',
  kind: 'render',
  theme: 'light',
  material: 'paper',
  fontFamily: 'system-ui',
  fontSize: 14,
  dpr: 1,
  width: 280,
  height: 180,
  region: null,
  quality: 1,
  format: 'png',
  snapshot: { schemaVersion: 1, documentId: 'current', sequence: 1, elements: [card] },
});

it('前台当前文档卡与后台出图保留相同的授权标题和无封面摘要', async () => {
  const title = '当前授权标题',
    summary = '没有封面也必须显示最新摘要。';
  const port: CanvasCardMediaPort = {
    projectId: () => 'project',
    preview: async input => ({
      documentId: input.documentId,
      title,
      nodeType: 'text',
      status: 'ready',
      content: { revisionKey: 'v1', summary },
    }),
    reference: async documentId => ({
      documentId,
      title,
      nodeType: 'text',
      status: 'available',
      path: 'workspace:/文档',
    }),
    subscribe: () => () => {},
    subscribeAvailability: () => () => {},
    readImage: async () => {
      throw new Error('unexpected image read');
    },
    previewImage: async () => {
      throw new Error('unexpected preview image read');
    },
    openDocument: async () => {},
  };
  const content = createCanvasCardContent('current', port);
  try {
    const frontend = await content.create(card, new AbortController().signal, 1);
    const worker = await createCardSurface(card, {
      ...request,
      documents: {
        'internal-target-id': { title, status: 'available', previewStatus: 'ready', summary },
      },
    });
    for (const element of [frontend, worker]) {
      expect(element.querySelector('.document-preview-name')?.textContent).toBe(title);
      expect(element.querySelector('.document-preview-title svg')).not.toBeNull();
      expect(element.querySelector('.document-preview-summary')?.textContent).toBe(summary);
      expect(element.querySelector('img,small')).toBeNull();
    }
  } finally {
    content.dispose();
  }
});
it('权限状态优先于迟到预览，不可访问卡和缺失metadata不泄露摘要、封面或内部ID', async () => {
  for (const status of ['deleted', 'outside_project', 'plugin_unavailable'] as const) {
    const element = await createCardSurface(card, {
      ...request,
      documents: {
        'internal-target-id': {
          title: '已授权身份',
          status,
          previewStatus: 'ready',
          summary: '不得出现的摘要',
          image: 'data:image/png;base64,YWJj',
        },
      },
    });
    expect(element.querySelector('img,.document-preview-summary')).toBeNull();
    expect(element.querySelector('.document-preview-status')?.textContent).toBeTruthy();
    expect(element.textContent).not.toContain('不得出现');
  }
  const unavailable = await createCardSurface(card, {
    ...request,
    documents: {
      'internal-target-id': {
        title: '当前标题',
        status: 'available',
        previewStatus: 'preview_unavailable',
        summary: '旧摘要',
      },
    },
  });
  expect(unavailable.querySelector('.document-preview-summary')).toBeNull();
  expect(unavailable.textContent).toContain('暂时没有可用预览');
  const missing = await createCardSurface(card, request);
  expect(missing.textContent).toContain('文档当前不可访问');
  expect(missing.textContent).not.toContain('internal-target-id');
});
it('停用插件显示当前授权文本快照及恢复提示，仍不显示旧封面', async () => {
  const element = await createCardSurface(card, {
    ...request,
    documents: {
      'internal-target-id': {
        title: '仍在项目中的文档',
        status: 'plugin_unavailable',
        previewStatus: 'plugin_unavailable',
        summary: '已保存的文本快照',
        image: 'data:image/png;base64,YWJj',
      },
    },
  });
  expect(element.querySelector('.document-preview-summary')?.textContent).toBe('已保存的文本快照');
  expect(element.querySelector('img')).toBeNull();
  expect(element.textContent).toContain('启用或安装');
});
it('有正文且内容方未声明缩略图时，前台与后台都按 Markdown 排版而不用封面图，并固定为卡片高度', async () => {
  const body = {
    format: 'markdown' as const,
    text: '# 季度复盘\n\n本季度围绕**画布**推进。\n\n- 第一项\n- 第二项',
  };
  const port: CanvasCardMediaPort = {
    projectId: () => 'project',
    preview: async input => ({
      documentId: input.documentId,
      title: '复盘',
      nodeType: 'text',
      status: 'ready',
      content: {
        revisionKey: 'v1',
        summary: '# 季度复盘 本季度围绕**画布**推进。',
        detail: body,
        image: { dataUri: 'data:image/png;base64,YWJj', widthPx: 10, heightPx: 10 },
      },
    }),
    reference: async documentId => ({
      documentId,
      title: '复盘',
      nodeType: 'text',
      status: 'available',
      path: 'workspace:/复盘',
    }),
    subscribe: () => () => {},
    subscribeAvailability: () => () => {},
    readImage: async () => {
      throw new Error('unexpected image read');
    },
    previewImage: async () => {
      throw new Error('unexpected preview image read');
    },
    openDocument: async () => {},
  };
  const content = createCanvasCardContent('current', port);
  try {
    const frontend = await content.create(card, new AbortController().signal, 1);
    const worker = await createCardSurface(card, {
      ...request,
      documents: {
        'internal-target-id': {
          title: '复盘',
          status: 'available',
          previewStatus: 'ready',
          summary: 'x',
          body,
          image: 'data:image/png;base64,YWJj',
        },
      },
    });
    for (const element of [frontend, worker]) {
      expect(element.querySelector('.document-preview-portable h1')?.textContent).toBe('季度复盘');
      expect(element.querySelector('.document-preview-portable strong')?.textContent).toBe('画布');
      expect(element.querySelectorAll('.document-preview-portable li')).toHaveLength(2);
      expect(element.textContent).not.toMatch(/[#*]/);
      expect(element.querySelector('.document-preview-summary, img')).toBeNull();
      expect(element.style.height).toBe(`${card.height}px`);
    }
  } finally {
    content.dispose();
  }
});
it('正式正文里的图片：前台按出图倍率向 Host 取共享地址并在出图后归还，后台用随请求内联的字节，卡面相同', async () => {
  // jsdom 不解码图片。
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value: async () => {},
  });
  const pixels = 'data:image/png;base64,YWJj';
  const body = {
    format: 'workspace-markdown' as const,
    document: {
      type: 'doc',
      content: [
        {
          type: 'rootBlock',
          attrs: { id: 'picture' },
          content: [
            {
              type: 'imageBlock',
              attrs: { id: 'picture-body', src: 'media://load/asset-image/a1', assetId: 'a1' },
            },
          ],
        },
      ],
    },
    images: { a1: { source: { assetId: 'a1' }, widthPx: 1600, heightPx: 900 } },
    references: {},
  };
  const release = vi.fn();
  const previewImage = vi.fn<CanvasCardMediaPort['previewImage']>(async () => ({
    url: 'blob:shared-picture',
    release,
  }));
  const port: CanvasCardMediaPort = {
    projectId: () => 'project',
    preview: async input => ({
      documentId: input.documentId,
      title: '带图文档',
      nodeType: 'document',
      status: 'ready',
      content: { revisionKey: 'v1', summary: '', detail: body },
    }),
    previewImage,
    reference: async documentId => ({
      documentId,
      title: '带图文档',
      nodeType: 'document',
      status: 'available',
      path: 'workspace:/带图文档',
    }),
    subscribe: () => () => {},
    subscribeAvailability: () => () => {},
    readImage: async () => {
      throw new Error('unexpected image read');
    },
    openDocument: async () => {},
  };
  const content = createCanvasCardContent('current', port);
  try {
    const frontend = await content.create(card, new AbortController().signal, 2);
    // 图片属于被引用的文档和当前项目；jsdom 没有布局，排出的尺寸为 0，取最小一档。
    expect(previewImage.mock.calls).toEqual([
      [
        {
          documentId: 'internal-target-id',
          projectId: 'project',
          source: { assetId: 'a1' },
          maxEdgePx: 512,
        },
      ],
    ]);
    const worker = await createCardSurface(card, {
      ...request,
      documents: {
        'internal-target-id': {
          title: '带图文档',
          status: 'available',
          previewStatus: 'ready',
          body,
          bodyImages: { a1: pixels },
        },
      },
    });
    expect(frontend.querySelector('img.image-block-img')?.getAttribute('src')).toBe(
      'blob:shared-picture'
    );
    expect(worker.querySelector('img.image-block-img')?.getAttribute('src')).toBe(pixels);
    for (const element of [frontend, worker])
      expect(element.querySelector('img.image-block-img')?.getAttribute('width')).toBe('1600');
    expect(release).not.toHaveBeenCalled();
    // 出图批次在画完后走这个释放口。
    disposeDocumentPreviewSurface(frontend);
    expect(release).toHaveBeenCalledTimes(1);
    // 后台请求没带上图片字节时明确失败，不交付缺图的卡面。
    await expect(
      createCardSurface(card, {
        ...request,
        documents: {
          'internal-target-id': {
            title: '带图文档',
            status: 'available',
            previewStatus: 'ready',
            body,
          },
        },
      })
    ).rejects.toThrow('preview_image_loader_missing');
  } finally {
    content.dispose();
  }
});
it('内容方声明缩略图时仍用封面图，正文不进卡片', async () => {
  const element = await createCardSurface(card, {
    ...request,
    documents: {
      'internal-target-id': {
        title: '路演',
        status: 'available',
        previewStatus: 'ready',
        image: 'data:image/png;base64,YWJj',
        keepThumbnail: true,
        body: { format: 'markdown', text: '# 不应出现' },
      },
    },
  });
  expect(element.querySelector('img.document-preview-cover')).not.toBeNull();
  expect(element.querySelector('.document-preview-portable')).toBeNull();
});
