// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { CanvasCardSchema } from '../../../../shared';
import { CanvasRenderRequestSchema } from '../../../../shared/rendering';
import { createCardSurface } from '../../../hidden-render-worker/functions/createCardSurface';
import { createCanvasCardContent, type CanvasCardMediaPort } from '../../cardMedia';

const source = { kind: 'user', conversationId: null, runId: null };
const card = CanvasCardSchema.parse({ id: 'c1', type: 'document', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white',
  createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, x: 0, y: 0, width: 280, height: 180, parentId: null, data: { documentId: 'internal-target-id' } });
const request = CanvasRenderRequestSchema.parse({ protocol: 1, requestId: 'summary', kind: 'render', theme: 'light', material: 'paper', fontFamily: 'system-ui', fontSize: 14,
  dpr: 1, width: 280, height: 180, region: null, quality: 1, format: 'png', snapshot: { schemaVersion: 1, documentId: 'current', sequence: 1, elements: [card] } });

it('前台当前文档卡与后台出图保留相同的授权标题和无封面摘要', async () => {
  const title = '当前授权标题', summary = '没有封面也必须显示最新摘要。';
  const port: CanvasCardMediaPort = { projectId: () => 'project', preview: async input => ({ documentId: input.documentId, title, nodeType: 'text', status: 'ready', content: { revisionKey: 'v1', summary } }),
    reference: async documentId => ({ documentId, title, nodeType: 'text', status: 'available', path: 'workspace:/文档' }), subscribe: () => () => {}, subscribeAvailability: () => () => {},
    readImage: async () => { throw new Error('unexpected image read'); }, openDocument: async () => {} };
  const content = createCanvasCardContent('current', port);
  try {
    const frontend = await content.create(card, new AbortController().signal);
    const worker = createCardSurface(card, { ...request, documents: { 'internal-target-id': { title, status: 'available', previewStatus: 'ready', summary } } });
    for (const element of [frontend, worker]) {
      expect(element.querySelector('strong.canvas-card-title')?.textContent).toBe(title);
      expect(element.querySelector('.canvas-document-summary')?.textContent).toBe(summary);
      expect(element.querySelector('img,small')).toBeNull();
    }
  } finally { content.dispose(); }
});
it('权限状态优先于迟到预览，不可访问卡和缺失metadata不泄露摘要、封面或内部ID', () => {
  for (const status of ['deleted', 'outside_project', 'plugin_unavailable'] as const) {
    const element = createCardSurface(card, { ...request, documents: { 'internal-target-id': { title: '已授权身份', status, previewStatus: 'ready', summary: '不得出现的摘要', image: 'data:image/png;base64,YWJj' } } });
    expect(element.querySelector('img,.canvas-document-summary')).toBeNull();
    expect(element.querySelector('.canvas-card-auxiliary')?.textContent).toBeTruthy();
    expect(element.textContent).not.toContain('不得出现');
  }
  const unavailable = createCardSurface(card, { ...request, documents: { 'internal-target-id': { title: '当前标题', status: 'available', previewStatus: 'preview_unavailable', summary: '旧摘要' } } });
  expect(unavailable.querySelector('.canvas-document-summary')).toBeNull();
  expect(unavailable.textContent).toContain('暂时没有可用预览');
  const missing = createCardSurface(card, request);
  expect(missing.textContent).toContain('文档当前不可访问'); expect(missing.textContent).not.toContain('internal-target-id');
});
it('停用插件显示当前授权文本快照及恢复提示，仍不显示旧封面', () => {
  const element = createCardSurface(card, { ...request, documents: { 'internal-target-id': { title: '仍在项目中的文档', status: 'plugin_unavailable', previewStatus: 'plugin_unavailable', summary: '已保存的文本快照', image: 'data:image/png;base64,YWJj' } } });
  expect(element.querySelector('.canvas-document-summary')?.textContent).toBe('已保存的文本快照');
  expect(element.querySelector('img')).toBeNull(); expect(element.textContent).toContain('启用或安装');
});
