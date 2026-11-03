// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasCardIdSchema, CanvasTextCardSchema, type CanvasCamera, type CanvasCardId } from '../../../../shared';
import type { CanvasInteractionKernel, CanvasKernelIntent } from '../../definitions/canvasKernel';
import { installCanvasInteraction } from '../installCanvasInteraction';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));
function fixture() {
  const canvas = document.createElement('canvas'); document.body.append(canvas);
  const captured = new Set<number>();
  canvas.setPointerCapture = id => { captured.add(id); };
  canvas.hasPointerCapture = id => captured.has(id);
  canvas.releasePointerCapture = id => { captured.delete(id); };
  const cards = [0, 120].map((x, index) => CanvasTextCardSchema.parse({ schemaVersion: 1, id: `c${index + 1}`, type: 'text', revision: 0, order: String(index), locked: false, color: 'white', x, y: 0, width: 100, height: 50, parentId: null, createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0, data: { contentVersion: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [] }] } } }));
  let selected: readonly CanvasCardId[] = cards.map(card => card.id);
  let camera: CanvasCamera = { x: 0, y: 0, zoom: 1 };
  const brush = vi.fn(), preview = vi.fn(), clear = vi.fn();
  const kernel: CanvasInteractionKernel = { canvas, readCamera: () => camera, setCamera: value => { camera = value; }, screenToWorld: point => ({ x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom }), readSelection: () => selected, hitTest: point => cards.find(card => point.x >= card.x && point.x <= card.x + card.width && point.y >= card.y && point.y <= card.y + card.height) ?? null, visibleCards: () => cards, setBrush: brush, setDragPreview: preview, clearDragPreview: clear };
  const intents: CanvasKernelIntent[] = [];
  const cleanup = installCanvasInteraction(kernel, intent => { intents.push(intent); if (intent.kind === 'select') selected = intent.additive ? [...selected, ...intent.ids] : intent.ids; });
  cleanups.push(() => { cleanup(); canvas.remove(); });
  const pointer = (type: string, x: number, y: number, options: MouseEventInit = {}) => {
    const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, ...options });
    Object.defineProperty(event, 'pointerId', { value: 1 }); canvas.dispatchEvent(event);
  };
  return { canvas, cards, intents, brush, preview, clear, pointer, selected: () => selected, kernel };
}

describe('Canvas pointer gestures', () => {
  it('单击多选中的卡在松手时折叠，未达到3屏幕像素不产生移动', () => {
    const f = fixture();
    f.pointer('pointerdown', 10, 10); f.pointer('pointermove', 12, 10); f.pointer('pointerup', 12, 10);
    expect(f.selected()).toEqual([CanvasCardIdSchema.parse('c1')]);
    expect(f.intents.filter(intent => intent.kind === 'move')).toEqual([]);
    expect(f.preview).not.toHaveBeenCalled();
  });

  it('拖动已多选的卡保留整组并产生实时显示预览，松手只提交一次', () => {
    const f = fixture();
    f.pointer('pointerdown', 10, 10); f.pointer('pointermove', 30, 20); f.pointer('pointermove', 40, 20); f.pointer('pointerup', 40, 20);
    expect(f.preview).toHaveBeenLastCalledWith(f.cards.map(card => card.id), 30, 10);
    const moves = f.intents.filter(intent => intent.kind === 'move');
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ ids: f.cards.map(card => card.id), dx: 30, dy: 10 });
  });

  it('框选实时更新，Cmd只选择完全包裹的卡，下一次按下不复用旧框', () => {
    const f = fixture();
    f.pointer('pointerdown', -10, -10); f.pointer('pointermove', 150, 100, { metaKey: true });
    expect(f.selected()).toEqual([CanvasCardIdSchema.parse('c1')]);
    expect(f.brush).toHaveBeenLastCalledWith({ x: -10, y: -10, width: 160, height: 110 });
    f.pointer('pointerup', 150, 100); f.pointer('pointerdown', 300, 300);
    expect(f.brush).toHaveBeenLastCalledWith(null);
  });

  it('Escape撤销显示预览、恢复选择并释放保护，之后松手不提交', () => {
    const f = fixture();
    f.pointer('pointerdown', 10, 10); f.pointer('pointermove', 50, 10);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); f.pointer('pointerup', 50, 10);
    expect(f.clear).toHaveBeenCalled();
    expect(f.intents.filter(intent => intent.kind === 'move')).toHaveLength(0);
    expect(f.intents).toContainEqual({ kind: 'editing', ids: f.cards.map(card => card.id), active: false });
  });

  it('阈值按屏幕像素而不是世界坐标判断', () => {
    const f = fixture(); f.kernel.setCamera({ x: 0, y: 0, zoom: 0.1 });
    f.pointer('pointerdown', 1, 1); f.pointer('pointermove', 2, 1); f.pointer('pointerup', 2, 1);
    expect(f.intents.filter(intent => intent.kind === 'move')).toHaveLength(0);
  });
});
