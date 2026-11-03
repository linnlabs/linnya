// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CanvasTextCardSchema } from '@plugin/canvas/shared';
import { createCanvasCardContent } from '..';
import type { CanvasCardMediaPort } from '..';
const image = { assetId: 'image-1', mediaType: 'image/png' as const, byteLength: 3, width: 1, height: 1, sha256: 'a'.repeat(64), dataUri: 'data:image/png;base64,YWJj' };
function fixture() {
  const readImage = vi.fn(async () => image);
  const port: CanvasCardMediaPort = { readImage, preview: async input => ({ documentId: input.documentId, title: null, nodeType: null, status: 'outside_project' }), projectId: () => 'project', openDocument: async () => {} };
  return { content: createCanvasCardContent('doc', port), readImage };
}
const card = CanvasTextCardSchema.parse({ id: 'c1', type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0, x: 0, y: 0, width: 280, height: 180, parentId: null, data: { contentVersion: 1, content: { type: 'doc', content: [{ type: 'image', attrs: { assetId: 'image-1', src: 'asset:image-1', alt: '', title: null } }] } } });
describe('受管卡片内容投影', () => {
  it('行内图片只临时替换DOM src，不改结构化正文或持久化dataURI', async () => {
    const f = fixture();
    const element = await f.content.create(card, new AbortController().signal);
    expect(element.querySelector('img')?.getAttribute('src')).toBe(image.dataUri);
    expect(card.data.content.content[0]?.attrs?.src).toBe('asset:image-1');
    expect(await f.content.resolveImageSource('asset:image-1')).toBe(image.dataUri);
    expect(f.readImage).toHaveBeenCalledTimes(1);
    f.content.dispose();
  });
  it('刚prepare尚未建立归属的插图可显示，读取失败明确失败不回退远程URL', async () => {
    const f = fixture(); f.content.stageImage(image);
    expect(await f.content.resolveImageSource('asset:image-1')).toBe(image.dataUri);
    expect(f.readImage).not.toHaveBeenCalled();
    f.readImage.mockRejectedValueOnce(new Error('asset missing'));
    await expect(f.content.resolveImageSource('asset:missing')).rejects.toThrow('asset missing');
    f.content.dispose();
  });
});
