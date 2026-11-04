import { CanvasTextCardSchema, type CanvasCard } from '../../src/shared';

type TextCard = Extract<CanvasCard, { readonly type: 'text' }>;

export type VisibleUpdateChange = 'color' | 'text';
const source = { kind: 'agent', conversationId: 'visible-update-probe', runId: 'diagnostic' };
export const VISIBLE_UPDATE_TEXT_FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif, -apple-system, "system-ui", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** text重建r4首个500之前的实际逻辑状态，不额外执行20轮warm写入。 */
export function createVisibleUpdateFixture(change: VisibleUpdateChange): TextCard[] {
  return Array.from({ length: 500 }, (_, i) => CanvasTextCardSchema.parse({ id: `c${i + 1}`, type: 'text', schemaVersion: 1,
    revision: change === 'text' && i < 50 ? 21 : 1, order: String(i).padStart(6, '0'),
    x: i % 25 * 104, y: Math.floor(i / 25) * 88, width: 88, height: 72,
    locked: false, color: 'white', parentId: null, createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0,
    data: { contentVersion: 1, heightMode: change === 'text' ? 'fixed' : 'auto', content: { type: 'doc', content: [{ type: 'paragraph',
      content: [{ type: 'text', text: change === 'text' && i < 50 ? `20:${String(i + 1).padStart(3, '0')}` : `卡 ${String(i + 1).padStart(3, '0')}` }] }] } },
  }));
}

export function changeVisibleUpdateFixture(cards: readonly TextCard[], change: VisibleUpdateChange, round: number): TextCard[] {
  return cards.map((card, i): TextCard => ({ ...card, revision: card.revision + 1,
    ...(change === 'color' ? { color: card.color === 'green' ? 'orange' : 'green' }
      : { data: { ...card.data, content: { type: 'doc', content: [{ type: 'paragraph',
        content: [{ type: 'text', text: `${String(round).padStart(2, '0')}:${String(i + 1).padStart(3, '0')}` }] }] } } }),
  }));
}
