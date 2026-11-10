import { describe, expect, it } from 'vitest';
import { CanvasElementSchema } from '../../model/definitions/canvasElement';
import { searchCanvasElements } from '../functions/searchCanvasElements';
const base = { id: 'c1', schemaVersion: 1, revision: 1, type: 'document', order: 'a0', color: 'white', locked: false, x: 0, y: 0, width: 280, height: 180, parentId: null,
  createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0, data: { documentId: 'internal-secret-id' } };
describe('画布搜索', () => {
  it('文档仅搜当前可访问标题，不把内部ID当作可见文字', () => {
    const card = CanvasElementSchema.parse(base);
    expect(searchCanvasElements([card], 'secret', { documentTitles: new Map() })).toEqual([]);
    expect(searchCanvasElements([card], '计划', { documentTitles: new Map([['internal-secret-id', '产品计划']]) })).toMatchObject([{ id: 'c1', text: '产品计划' }]);
  });
  it('匹配正文与公式，结果按阅读顺序排列', () => {
    const later = CanvasElementSchema.parse({ ...base, id: 'c2', y: 100, type: 'text', data: { contentVersion: 1, heightMode: 'auto', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'PLAN' }] }] } } });
    const earlier = CanvasElementSchema.parse({ ...base, type: 'text', data: { contentVersion: 1, heightMode: 'auto', content: { type: 'doc', content: [{ type: 'blockMath', attrs: { latex: 'plan(x)' } }] } } });
    expect(searchCanvasElements([later, earlier], 'plan', { documentTitles: new Map() }).map(hit => hit.id)).toEqual(['c1', 'c2']);
  });
});
