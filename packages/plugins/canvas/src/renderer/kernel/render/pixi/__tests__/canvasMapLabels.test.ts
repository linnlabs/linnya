import { afterEach, expect, it, vi } from 'vitest';
import { CanvasCardSchema, type CanvasCard } from '../../../../../shared';
import { CanvasMapLabels } from '../CanvasMapLabels';

vi.mock('pixi.js', () => ({
  Texture: { from: () => ({ source: { update: vi.fn() }, destroy: vi.fn() }) },
  Sprite: class {
    visible = true; width = 0; height = 0;
    readonly position = { set: vi.fn() };
    readonly destroy = vi.fn();
  },
}));

const source = { kind: 'user', conversationId: null, runId: null };
function card(index: number, x: number, y: number, title = `主题${index}`) {
  return CanvasCardSchema.parse({ id: `c${index}`, schemaVersion: 1, revision: 1, order: `a${index}`, locked: false,
    color: 'white', createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, x, y, width: 240, height: 120,
    parentId: null, type: 'text', data: { contentVersion: 1, content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: title }] },
    ] } } });
}
function setup(width: (text: string) => number = () => 80) {
  // 控制度量只验证实际owner的数据流/避让，不把此CPU fixture当成系统字体或GPU像素证明。
  const measureText = vi.fn((text: string) => ({ width: text.length ? width(text) : 0 }));
  const context = { font: '', textBaseline: '', globalAlpha: 1, fillStyle: '', measureText, clearRect: vi.fn(), fillText: vi.fn() };
  const canvas = { width: 0, height: 0, getContext: () => context };
  vi.stubGlobal('document', { createElement: () => canvas });
  return { labels: new CanvasMapLabels(), measureText, fillText: context.fillText };
}
afterEach(() => { vi.unstubAllGlobals(); });

it('60张卡排成四组后，150px同格里的分离短标题不会整列消失，pan仍复用同一排版', () => {
  const state = setup(), cards = Array.from({ length: 60 }, (_, index) => card(index + 1, index % 4 * 320, Math.floor(index / 4) * 160));
  const input = { cards, width: 1400, height: 900, dark: false, visible: true,
    camera: { x: 40, y: 131.18644067796612, zoom: 0.2796610169491525 } };
  state.labels.draw(input);
  expect(cards.every(card => state.labels.hasLabel(card.id))).toBe(true); expect(state.fillText).toHaveBeenCalledTimes(60);
  const measurements = state.measureText.mock.calls.length;
  state.labels.draw({ ...input, camera: { ...input.camera, x: input.camera.x + 10 } });
  expect(state.fillText).toHaveBeenCalledTimes(60); expect(state.measureText).toHaveBeenCalledTimes(measurements);
  state.labels.destroy();
});

it('真实相交按输入优先序保留首标签，12k重叠候选在测宽前排除且重画不重复测宽', () => {
  const state = setup(), cards = Array.from({ length: 12000 }, (_, index) => card(index + 1, 0, 0, `独立标题${index}`));
  const input = { cards, width: 1400, height: 900, dark: false, visible: true, camera: { x: 0, y: 0, zoom: 0.1 } };
  state.labels.draw(input);
  expect(state.labels.hasLabel(cards[0].id)).toBe(true); expect(state.labels.hasLabel(cards[1].id)).toBe(false);
  expect(state.fillText).toHaveBeenCalledTimes(1); expect(state.measureText).toHaveBeenCalledTimes(1);
  state.labels.invalidate(); state.labels.draw(input);
  expect(state.fillText).toHaveBeenCalledTimes(2); expect(state.measureText).toHaveBeenCalledTimes(1);
  const preferred = cards[5000];
  state.labels.draw({ ...input, cards: [preferred, ...cards.filter(card => card !== preferred)] });
  expect(state.labels.hasLabel(preferred.id)).toBe(true); expect(state.labels.hasLabel(cards[0].id)).toBe(false);
  expect(state.fillText).toHaveBeenCalledTimes(3); expect(state.measureText).toHaveBeenCalledTimes(2);
  state.labels.destroy();
});

it('隐藏长文档改短需要重新避让；anchor快拒的候选不额外登记标题宽度依赖', () => {
  const state = setup(text => text === '优先' ? 20 : text === '短' ? 10 : 80);
  const priority = card(1, 790, 0, '优先');
  const document = CanvasCardSchema.parse({ ...card(2, 690, 0), type: 'document', data: { documentId: 'source-document' } });
  const covered = card(3, 840, 0, '被左边缘遮住'); let documentTitle = '长文档标题';
  const input = { cards: [priority, document, covered], width: 1400, height: 900, dark: false, visible: true,
    camera: { x: -160, y: -160, zoom: 0.2 }, readTitle: (card: CanvasCard) => card.type === 'document' ? documentTitle : card.id === priority.id ? '优先' : '被左边缘遮住' };
  state.labels.draw(input);
  expect(state.labels.hasLabel(document.id)).toBe(false); expect(state.labels.dependsOnTitle(document.id)).toBe(true);
  expect(state.labels.dependsOnTitle(covered.id)).toBe(false);
  documentTitle = '短'; state.labels.invalidate(); state.labels.draw(input);
  expect(state.labels.hasLabel(document.id)).toBe(true); expect(state.labels.hasLabel(priority.id)).toBe(true);
  state.labels.draw({ ...input, cards: [] }); expect(state.labels.dependsOnTitle(document.id)).toBe(false);
  state.labels.destroy();
});
