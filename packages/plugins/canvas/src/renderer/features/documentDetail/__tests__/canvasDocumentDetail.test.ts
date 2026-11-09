// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import { CanvasDocumentCardSchema } from '@plugin/canvas/shared';
import type { CanvasDocumentDetailPort } from '../definitions/documentDetail';
import { createCanvasDocumentDetail } from '../orchestration/createCanvasDocumentDetail';
import { canvasDocumentDetailTarget } from '../functions/canvasDocumentDetailTarget';
import { installCanvasDocumentNavigation } from '../orchestration/installCanvasDocumentNavigation';
import CanvasDocumentDetail from '../ui/CanvasDocumentDetail.vue';

function card() { return CanvasDocumentCardSchema.parse({ id: 'c1', type: 'document', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0, x: 0, y: 0, width: 280, height: 180, parentId: null, data: { documentId: 'target' } }); }
function port(): CanvasDocumentDetailPort { return { prepare: vi.fn(async () => 'ready'), mount: vi.fn(async () => vi.fn()), visible: vi.fn(), focus: vi.fn(), open: vi.fn(), navigate: vi.fn() }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }

describe('单张近景文档详情', () => {
  it('框选、远景、正文编辑和缺项目时不创建详情，锁定卡仍可只读', () => {
    const input = { cards: [card()], zoom: 1, editing: false, projectId: 'project', dismissed: null };
    expect(canvasDocumentDetailTarget(input)?.id).toBe('c1');
    expect(canvasDocumentDetailTarget({ ...input, cards: [{ ...card(), locked: true }] })?.id).toBe('c1');
    for (const change of [{ zoom: 0.74 }, { editing: true }, { projectId: null }, { cards: [card(), card()] }, { dismissed: card().id }]) expect(canvasDocumentDetailTarget({ ...input, ...change })).toBeNull();
  });
  it('先等当前倍率精确位图，再由Host挂载，只在挂载成功后隐藏位图', async () => {
    const prepared = deferred<'ready' | 'unavailable'>(), mounted = deferred<() => void>(), host = port(), release = vi.fn();
    host.prepare = () => prepared.promise; host.mount = vi.fn(() => mounted.promise);
    const element = document.createElement('div'), detail = createCanvasDocumentDetail({ card: card(), projectId: 'project', element, port: host });
    const waiting = detail.mount(); expect(host.mount).not.toHaveBeenCalled();
    prepared.resolve('ready'); await Promise.resolve(); expect(host.mount).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'target', projectId: 'project', element })); expect(host.visible).not.toHaveBeenCalled();
    mounted.resolve(release); await waiting; expect(host.visible).toHaveBeenLastCalledWith(card().id, true); expect(detail.state.ready.value).toBe(true);
    detail.dispose(); detail.dispose(); expect(release).toHaveBeenCalledTimes(1); expect(host.visible).toHaveBeenLastCalledWith(card().id, false);
  });
  it('切卡/关闭发生在准备中时不挂载；懒加载迟到时只释放自身挂载', async () => {
    const prepared = deferred<'ready' | 'unavailable'>(), host = port(); host.prepare = () => prepared.promise;
    const detail = createCanvasDocumentDetail({ card: card(), projectId: 'project', element: document.createElement('div'), port: host });
    const waiting = detail.mount(); detail.dispose(); prepared.resolve('ready'); await waiting; expect(host.mount).not.toHaveBeenCalled();
    const mounted = deferred<() => void>(), release = vi.fn(), lateHost = port(); lateHost.mount = () => mounted.promise;
    const late = createCanvasDocumentDetail({ card: card(), projectId: 'project', element: document.createElement('div'), port: lateHost });
    const pending = late.mount(); await Promise.resolve(); late.dispose(); mounted.resolve(release); await pending;
    expect(release).toHaveBeenCalledTimes(1); expect(lateHost.visible).not.toHaveBeenCalledWith(card().id, true);
  });
  it('精确位图不可用仍静默显示详情；权限拒绝保留封面并显示正式错误', async () => {
    const host = port(); host.prepare = async () => 'unavailable';
    const detail = createCanvasDocumentDetail({ card: card(), projectId: 'project', element: document.createElement('div'), port: host }); await detail.mount();
    expect(detail.state.ready.value).toBe(true); expect(detail.state.notice.value).toBeNull(); detail.dispose();
    const denied = port(); denied.mount = async () => { throw new Error('目标已移出当前项目'); };
    const failure = createCanvasDocumentDetail({ card: card(), projectId: 'project', element: document.createElement('div'), port: denied }); await failure.mount();
    expect(failure.state.ready.value).toBe(false); expect(failure.state.notice.value).toBe('目标已移出当前项目'); expect(denied.visible).not.toHaveBeenCalled(); failure.dispose();
  });
  it('普通滚动保留详情，捏合缩放交给相机；按钮Space不被劫持', () => {
    const element = document.createElement('section'), button = document.createElement('button'); element.append(button); document.body.append(element);
    const navigate = vi.fn(), remove = installCanvasDocumentNavigation(element, navigate);
    const scroll = new WheelEvent('wheel', { deltaY: 30, bubbles: true, cancelable: true }); element.dispatchEvent(scroll); expect(scroll.defaultPrevented).toBe(false); expect(navigate).not.toHaveBeenCalled();
    const zoom = new WheelEvent('wheel', { ctrlKey: true, deltaY: 30, bubbles: true, cancelable: true }); element.dispatchEvent(zoom); expect(zoom.defaultPrevented).toBe(true); expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'zoom', deltaY: 30 }));
    const space = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }); button.dispatchEvent(space); expect(space.defaultPrevented).toBe(false);
    remove(); element.remove();
  });
  it('真实只读覆盖层承接Host正文，Esc回焦，卸载释放Host实例和活DOM槽', async () => {
    const host = port(), release = vi.fn(), close = vi.fn();
    host.mount = async input => { const paragraph = document.createElement('p'); paragraph.textContent = '只读正文，可选择复制'; input.element.append(paragraph); return release; };
    const root = document.createElement('div'); document.body.append(root);
    const app = createApp(CanvasDocumentDetail, { card: card(), camera: { x: 10, y: 20, zoom: 1 }, projectId: 'project', title: '项目文档', port: host, onClose: close });
    app.mount(root); await Promise.resolve(); await Promise.resolve(); await nextTick();
    expect(root.textContent).toContain('只读正文，可选择复制'); expect(root.querySelector('[contenteditable]')).toBeNull(); expect(host.visible).toHaveBeenCalledWith(card().id, true);
    const shortcut = vi.fn(); root.addEventListener('keydown', shortcut);
    root.querySelector('section')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true })); expect(shortcut).toHaveBeenCalledOnce();
    root.querySelector('section')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); expect(shortcut).toHaveBeenCalledOnce();
    root.querySelector('section')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(close).toHaveBeenCalledTimes(1); expect(host.focus).toHaveBeenCalledTimes(1);
    app.unmount(); expect(release).toHaveBeenCalledTimes(1); expect(host.visible).toHaveBeenLastCalledWith(card().id, false); root.remove();
  });
});
