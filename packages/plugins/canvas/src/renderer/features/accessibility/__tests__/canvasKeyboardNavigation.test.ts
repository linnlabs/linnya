// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { CanvasCardIdSchema, CanvasTextCardSchema, createCanvasPlainTextDocument, type CanvasCardId } from '@plugin/canvas/shared';
import type { CanvasKeyboardActions } from '../definitions/canvasKeyboard';
import { createCanvasKeyboardNavigation } from '../orchestration/createCanvasKeyboardNavigation';
import { createCanvasKeyboardHandler } from '../orchestration/createCanvasKeyboardHandler';
import { canvasRevealCardCamera } from '../../../functions/canvasRevealCardCamera';
import { describeCanvasSelection } from '../functions/describeCanvasSelection';

function card(id: string, x: number, y = 0, width = 100, height = 100) { return CanvasTextCardSchema.parse({ id, x, y, width, height, type: 'text', schemaVersion: 1, revision: 1, order: 'a0', color: 'white', locked: true, parentId: null, createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0, data: { contentVersion: 1, content: createCanvasPlainTextDocument(`正文${id}`) } }); }
function fixture(cards = [card('c1', 0), card('c2', 200), card('c3', 200, 200)]) {
  let selection: readonly CanvasCardId[] = [];
  const reveal = vi.fn(), select = vi.fn(async (ids: readonly CanvasCardId[]) => { selection = ids; });
  const navigation = createCanvasKeyboardNavigation({ elements: () => cards, selection: () => selection, select, reveal });
  const actions: CanvasKeyboardActions = { isEditing: () => false, selection: () => selection, allIds: () => cards.map(item => item.id), zoomValue: () => 1, duplicate: vi.fn(), undo: vi.fn(), remove: vi.fn(), edit: vi.fn(), escape: vi.fn(), select, fit: vi.fn(), zoom: vi.fn(), move: vi.fn(), navigation };
  return { actions, cards, select, reveal, selection: () => selection, handler: createCanvasKeyboardHandler(actions) };
}
it('Tab逐卡朗读且首尾可离开画布；锁定卡仍可选择，不生成移动写入', async () => {
  const f = fixture();
  for (const target of f.cards) {
    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }); const completion = f.handler(event);
    expect(event.defaultPrevented).toBe(true); await completion; expect(f.selection()).toEqual([target.id]);
  }
  const exit = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }); await f.handler(exit); expect(exit.defaultPrevented).toBe(false);
  await f.handler(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true })); expect(f.selection()).toEqual(['c2']); expect(f.actions.move).not.toHaveBeenCalled();
  const summary = describeCanvasSelection(f.cards, f.selection(), new Map()); expect(summary).toContain('文字卡，已锁定：正文c2'); expect(summary).toContain('第2/3张');
});
it('Command方向选择空间邻居，普通方向保留移动；输入框和按钮的Tab不被消费', async () => {
  const f = fixture(); await f.select([CanvasCardIdSchema.parse('c1')]);
  await f.handler(new KeyboardEvent('keydown', { key: 'ArrowRight', metaKey: true, cancelable: true })); expect(f.selection()).toEqual(['c2']);
  await f.handler(new KeyboardEvent('keydown', { key: 'ArrowDown', ctrlKey: true, cancelable: true })); expect(f.selection()).toEqual(['c3']);
  await f.handler(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true })); expect(f.actions.move).toHaveBeenCalledWith(['c3'], -1, 0);
  for (const tag of ['button', 'input']) { const element = document.createElement(tag), event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }); element.addEventListener('keydown', received => { void f.handler(received); }); element.dispatchEvent(event); expect(event.defaultPrevented).toBe(false); }
});
it('异步保存前同步阻止Tab默认跳焦；失败保留选择时不移动视口', async () => {
  const f = fixture(); let finish!: () => void; f.select.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }), pending = f.handler(event); expect(event.defaultPrevented).toBe(true);
  finish(); await pending; expect(f.selection()).toEqual([]); expect(f.reveal).not.toHaveBeenCalled();
});
it('键盘导航仅按需平移，倍率不变；超长卡优先显示卡顶', () => {
  const camera = { x: 0, y: 0, zoom: 1 };
  expect(canvasRevealCardCamera({ camera, card: { x: 40, y: 40, width: 100, height: 100 }, width: 500, height: 400 })).toEqual(camera);
  expect(canvasRevealCardCamera({ camera, card: { x: 900, y: 1000, width: 200, height: 3000 }, width: 500, height: 400 })).toEqual({ zoom: 1, x: -628, y: -972 });
});

const press = (f: ReturnType<typeof fixture>, key: string, init: KeyboardEventInit = {}) => f.handler(new KeyboardEvent('keydown', { key, cancelable: true, ...init }));
const ids = (...values: string[]) => values.map(value => CanvasCardIdSchema.parse(value));
it('Tab按版面阅读顺序而非叠放顺序；多选时从选区之后继续，Shift+Tab从选区之前继续', async () => {
  // 数组顺序是拖动后的叠放顺序，与位置无关。
  const f = fixture([card('c4', 200, 200), card('c1', 0, 0), card('c3', 0, 200), card('c2', 200, 0)]);
  for (const target of ['c1', 'c2', 'c3', 'c4']) { await press(f, 'Tab'); expect(f.selection()).toEqual([target]); }
  await f.select(ids('c3', 'c1')); await press(f, 'Tab'); expect(f.selection()).toEqual(['c4']);
  await f.select(ids('c4', 'c2')); await press(f, 'Tab', { shiftKey: true }); expect(f.selection()).toEqual(['c1']);
  expect(describeCanvasSelection(f.cards, ids('c4', 'c1'), new Map())).toMatch(/正文c1.*第1\/4张.*正文c4.*第4\/4张/);
});
it('Command方向先选正对着的卡，再选45°内最近的；该方向没有卡时不消费按键', async () => {
  // c2斜上方更近，c3正对但更远：正对优先。
  const f = fixture([card('c1', 0, 200), card('c2', 160, 60), card('c3', 400, 220), card('c4', 0, 600)]);
  await f.select(ids('c1')); await press(f, 'ArrowRight', { metaKey: true }); expect(f.selection()).toEqual(['c3']);
  await f.select(ids('c3')); await press(f, 'ArrowLeft', { metaKey: true }); expect(f.selection()).toEqual(['c1']);
  await f.select(ids('c2')); await press(f, 'ArrowDown', { metaKey: true }); expect(f.selection()).toEqual(['c4']);
  await f.select(ids('c4')); const blocked = new KeyboardEvent('keydown', { key: 'ArrowDown', metaKey: true, cancelable: true });
  await f.handler(blocked); expect(blocked.defaultPrevented).toBe(false); expect(f.selection()).toEqual(['c4']);
});
