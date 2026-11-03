// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasTextCardSchema } from '@plugin/canvas/shared';
import { CANVAS_CLIPBOARD_MIME, installCanvasClipboard } from '..';
import type { CanvasClipboardPort } from '../definitions/canvasClipboardPort';
const card = CanvasTextCardSchema.parse({ id: 'c1', type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0, x: 0, y: 0, width: 280, height: 180, parentId: null, data: { contentVersion: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '粗体', marks: [{ type: 'bold' }] }] }] } } });
class Item { constructor(readonly values: Record<string, Blob | Promise<Blob>>) {} get types() { return Object.keys(this.values); } async getType(type: string) { const value = await this.values[type]; if (!value) throw new Error('missing format'); return value; } }
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  let contents: Item[] = [];
  vi.stubGlobal('ClipboardItem', Item); vi.stubGlobal('Blob', NodeBlob);
  const write = vi.fn(async (items: Item[]) => { await Promise.all(items.flatMap(item => item.types.map(type => item.getType(type)))); contents = items; });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write, read: async () => contents } });
  const port: CanvasClipboardPort = { canHandle: () => true, canWrite: () => true, read: () => [card], pastePoint: () => ({ x: 100, y: 100 }), prepare: async () => ({ elements: [card], text: '**粗体**' }), pasteElements: vi.fn(), pasteText: vi.fn(), pasteImages: vi.fn(), cut: vi.fn(), fail: vi.fn() };
  const clipboard = installCanvasClipboard(document.createElement('div'), port);
  return { clipboard, port, write, contents: () => contents };
}
it('同一次复制保留子图与Markdown，剪切等剪贴板成功后只删除冻结版本', async () => {
  const f = fixture(); await f.clipboard.cut();
  const item = f.contents()[0]; expect(item?.types).toContain(`web ${CANVAS_CLIPBOARD_MIME}`);
  expect(f.port.cut).toHaveBeenCalledExactlyOnceWith([card]);
  expect(await (await item?.getType('text/plain'))?.text()).toBe('**粗体**');
  await f.clipboard.paste(); expect(f.port.pasteElements).toHaveBeenCalledWith([card], { x: 100, y: 100 }); f.clipboard.dispose();
});
it('复制读取失效或剪贴板拒绝时不删除原卡，关闭后等待中的剪切也不写文档', async () => {
  const f = fixture(); f.port.prepare = async () => { throw new Error('画布已变化'); };
  await expect(f.clipboard.cut()).rejects.toThrow('画布已变化'); expect(f.port.cut).not.toHaveBeenCalled();
  let finish!: (value: { elements: readonly (typeof card)[]; text: string }) => void; f.port.prepare = () => new Promise(resolve => { finish = resolve; });
  const pending = f.clipboard.cut(); f.clipboard.dispose(); finish({ elements: [card], text: '最新' }); await pending; expect(f.port.cut).not.toHaveBeenCalled();
});
it('只读仍可复制，等待期间转只读的剪切只复制不删除，粘贴也不写入', async () => {
  const f = fixture(); f.port.canWrite = () => false;
  await f.clipboard.copy(); expect(f.write).toHaveBeenCalledOnce();
  await expect(f.clipboard.cut()).rejects.toThrow('只读');
  await expect(f.clipboard.paste()).rejects.toThrow('只读'); expect(f.port.cut).not.toHaveBeenCalled();
  f.port.canWrite = () => true;
  f.port.prepare = async () => { f.port.canWrite = () => false; return { elements: [card], text: '正文' }; };
  await expect(f.clipboard.cut()).rejects.toThrow('原卡已保留'); expect(f.port.cut).not.toHaveBeenCalled(); f.clipboard.dispose();
});
