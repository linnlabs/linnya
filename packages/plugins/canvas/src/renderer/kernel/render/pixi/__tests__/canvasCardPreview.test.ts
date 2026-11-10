import { expect, it, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { CanvasCardSchema, type CanvasCard, type CanvasCardId } from '../../../../../shared';
import { CanvasCardPreview } from '../CanvasCardPreview';
import type { CanvasCardView } from '../definitions/canvasCardView';
import { canvasCardContentChanged, canvasCardRasterChanged } from '../../../motion';

const source = { kind: 'agent', conversationId: 'conversation', runId: 'run' };
const card = (patch: Partial<CanvasCard> = {}) =>
  CanvasCardSchema.parse({
    id: 'c1',
    type: 'text',
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
    width: 200,
    height: 140,
    parentId: null,
    data: { contentVersion: 1, heightMode: 'auto', content: { type: 'doc', content: [] } },
    ...patch,
  });

function setup(initial: CanvasCard) {
  const view = {
    card: initial,
    container: new Container(),
    body: new Container(),
  } as unknown as CanvasCardView;
  const views = new Map<CanvasCardId, CanvasCardView>([[initial.id, view]]),
    cards = new Map<CanvasCardId, CanvasCard>([[initial.id, initial]]),
    originals = new Map<CanvasCardId, CanvasCard>();
  const context = {
    views,
    cards,
    originals,
    freeze: vi.fn(),
    move: vi.fn(),
    resize: vi.fn(),
    readMaterial: () => 'paper' as const,
  };
  return { view, cards, originals, context, preview: new CanvasCardPreview(context) };
}
/** 遮罩与纸面同形：几何框内缩 3px，选中描边所在的纸外一圈不被旧排版压住。 */
const maskSize = (view: CanvasCardView) => {
  const mask = view.body.mask;
  expect(mask).toBeInstanceOf(Graphics);
  const bounds = (mask as Graphics).getLocalBounds();
  expect([bounds.x, bounds.y]).toEqual([3, 3]);
  return [bounds.width, bounds.height];
};

it('改尺寸只改显示副本，正文旧排版裁在当前纸面内；取消后按原尺寸重新贴合', () => {
  const initial = card(),
    { view, cards, originals, context, preview } = setup(initial);
  expect(preview.resize(initial.id, { width: 120, height: 90 })).toBe(true);
  expect(initial.width).toBe(200);
  expect(cards.get(initial.id)).toBe(view.card);
  expect(view.card).toMatchObject({ width: 120, height: 90 });
  expect(originals.get(initial.id)).toBe(initial);
  expect(preview.resizing).toBe(initial.id);
  expect(context.resize).toHaveBeenCalledWith(view);
  expect(maskSize(view)).toEqual([114, 84]);
  expect(preview.resize(initial.id, { width: 160, height: 90 })).toBe(false);
  expect(maskSize(view)).toEqual([154, 84]);

  preview.restore(new Map([[initial.id, initial]]));
  expect(view.card).toBe(initial);
  expect(originals.size).toBe(0);
  expect(preview.resizing).toBeNull();
  expect(maskSize(view)).toEqual([194, 134]);
});

it('改尺寸落地后的第一份新正文直接替换，不与旧排版交叉淡变；拖动不触发替换', () => {
  const initial = card(),
    { preview, originals } = setup(initial);
  preview.place([initial.id], (display, original) => {
    display.x = original.x + 10;
  });
  preview.restore(new Map([[initial.id, initial]]));
  expect(preview.takeSwap(initial.id)).toBe(false);
  preview.resize(initial.id, { width: 120, height: 90 });
  const committed = card({ revision: 2, width: 120, height: 90 });
  // 快照落地时内核把手势原卡换成新尺寸（只保留拖动起点的位置），恢复时不能再拿它判断尺寸变化。
  originals.set(initial.id, committed);
  preview.restore(new Map([[initial.id, committed]]));
  expect(preview.takeSwap(initial.id)).toBe(true);
  expect(preview.takeSwap(initial.id)).toBe(false);
});

it('松手后到新排版装上前一直按旧排版显示：不撤旧正文、不补占位标题；拖动不算', () => {
  const initial = card(),
    { preview } = setup(initial);
  preview.place([initial.id], (display, original) => {
    display.x = original.x + 10;
  });
  expect(preview.showsOldLayout(initial.id)).toBe(false);
  preview.restore(new Map([[initial.id, initial]]));
  expect(preview.showsOldLayout(initial.id)).toBe(false);

  preview.resize(initial.id, { width: 120, height: 90 });
  expect(preview.showsOldLayout(initial.id)).toBe(true);
  preview.restore(new Map([[initial.id, card({ revision: 2, width: 120, height: 90 })]]));
  expect(preview.resizing).toBeNull();
  expect(preview.showsOldLayout(initial.id)).toBe(true);
  expect(preview.showsOldLayout('other' as CanvasCardId)).toBe(false);
  expect(preview.takeSwap(initial.id)).toBe(true);
  expect(preview.showsOldLayout(initial.id)).toBe(false);
});

it('取消或提交失败时尺寸没变，不等待新排版', () => {
  const initial = card(),
    { preview } = setup(initial);
  preview.resize(initial.id, { width: 120, height: 90 });
  preview.restore(new Map([[initial.id, initial]]));
  expect(preview.resizing).toBeNull();
  expect(preview.showsOldLayout(initial.id)).toBe(false);
  expect(preview.takeSwap(initial.id)).toBe(false);
});

it('改尺寸落地只换排版不换正文；染纸、类型或正文变了才算内容过期', () => {
  const before = card();
  expect(canvasCardContentChanged(before, card({ revision: 2, width: 120, height: 90 }))).toBe(
    false
  );
  expect(
    canvasCardContentChanged(
      before,
      card({
        revision: 2,
        data: { contentVersion: 1, heightMode: 'fixed', content: { type: 'doc', content: [] } },
      })
    )
  ).toBe(false);
  expect(canvasCardContentChanged(before, card({ revision: 2, color: 'green' }))).toBe(true);
});

it('只改 heightMode 不撤正文采样；尺寸或正文变化仍撤', () => {
  const before = card(),
    fixed = card({
      revision: 2,
      data: { contentVersion: 1, heightMode: 'fixed', content: { type: 'doc', content: [] } },
    });
  expect(canvasCardRasterChanged(before, fixed)).toBe(false);
  expect(canvasCardRasterChanged(before, { ...fixed, width: 120 })).toBe(true);
  expect(
    canvasCardRasterChanged(
      before,
      card({
        revision: 2,
        data: {
          contentVersion: 1,
          heightMode: 'auto',
          content: { type: 'doc', content: [{ type: 'paragraph' }] },
        },
      })
    )
  ).toBe(true);
});
